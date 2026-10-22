-- Purchases from suppliers (Task 017A).
--
-- The workshop buys on each supplier's website; the app prepares what to buy,
-- follows the purchase and records its arrival:
-- * "Por comprar" is CALCULATED, never typed: what active orders still miss
--   (needed - reserved - used) plus stock below its minimum and manual needs,
--   minus free stock and minus what sent purchases still have to deliver.
-- * One purchase per supplier (C-YYYY/NNN, own counter "COM"): borrador ->
--   pedida, or cancelada. "Recibida" and "llegó en parte" are derived from the
--   receipts, so the state can never disagree with the stock movements.
-- * A receipt is ONE transaction: one stock entry per line (unique link, real
--   price), then reservations for the orders that still miss those garments
--   (nearest delivery date first, then order id), recalculated at that very
--   moment; the rest stays free. Orders whose material becomes complete move
--   to "listo_produccion" when allowed. A client key makes repeated requests
--   (double click, retry) harmless, and the confirmed plan must still match.
-- * Prices: each line keeps the catalogue price as expected (tax base + VAT %)
--   and each receipt the real one; the stock entry cost is the real price with
--   VAT, as catalogue costs are. Catalogue, quotes and orders are never changed.
--
-- Safety: adds tables, a column, views and functions; recreates two order views
-- with the same columns. Existing rows are not changed. Re-runnable.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.compras (
  id bigint generated always as identity primary key,
  numero text not null unique,
  proveedor_id bigint not null references public.proveedores on delete restrict,
  estado text not null default 'borrador' check (estado in ('borrador', 'pedida', 'cancelada')),
  referencia_proveedor text,
  fecha_pedido date,
  notas text,
  motivo_cancelacion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint compras_pedida_con_fecha check (estado <> 'pedida' or fecha_pedido is not null)
);
-- At most one draft per supplier: preparing again updates it
create unique index if not exists compras_borrador_por_proveedor on public.compras (proveedor_id) where estado = 'borrador';
create index if not exists compras_estado_idx on public.compras (estado, proveedor_id);

create table if not exists public.compra_lineas (
  id bigint generated always as identity primary key,
  compra_id bigint not null references public.compras on delete restrict,
  variante_id bigint not null references public.variantes on delete restrict,
  para_pedidos integer not null default 0 check (para_pedidos >= 0),
  reposicion integer not null default 0 check (reposicion >= 0),
  cantidad_cerrada integer not null default 0 check (cantidad_cerrada >= 0), -- pending given up ("no llegará")
  precio_neto numeric(12, 4) check (precio_neto is null or precio_neto >= 0),   -- expected unit tax base
  iva_porcentaje numeric(5, 2) check (iva_porcentaje is null or iva_porcentaje between 0 and 100), -- null: price includes VAT
  descripcion text not null check (length(trim(descripcion)) > 0),
  referencia text,
  orden integer not null default 0,
  unique (compra_id, variante_id),
  constraint compra_lineas_cantidad check (para_pedidos + reposicion > 0),
  constraint compra_lineas_cerrada check (cantidad_cerrada <= para_pedidos + reposicion)
);
create index if not exists compra_lineas_variante_idx on public.compra_lineas (variante_id);

create table if not exists public.compra_recepciones (
  id bigint generated always as identity primary key,
  compra_id bigint not null references public.compras on delete restrict,
  clave uuid not null unique, -- sent by the app: the same request twice records one receipt
  fecha date not null default current_date,
  albaran text,
  resumen jsonb not null default '{}'::jsonb,
  usuario uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index if not exists compra_recepciones_compra_idx on public.compra_recepciones (compra_id);

create table if not exists public.compra_recepcion_lineas (
  id bigint generated always as identity primary key,
  recepcion_id bigint not null references public.compra_recepciones on delete restrict,
  compra_linea_id bigint not null references public.compra_lineas on delete restrict,
  cantidad integer not null check (cantidad > 0),
  precio_neto numeric(12, 4) check (precio_neto is null or precio_neto >= 0), -- real unit tax base
  iva_porcentaje numeric(5, 2) check (iva_porcentaje is null or iva_porcentaje between 0 and 100),
  movimiento_id bigint not null unique references public.stock_movimientos on delete restrict, -- one entry per received line
  unique (recepcion_id, compra_linea_id)
);
create index if not exists compra_recepcion_lineas_linea_idx on public.compra_recepcion_lineas (compra_linea_id);

create table if not exists public.compra_eventos (
  id bigint generated always as identity primary key,
  compra_id bigint not null references public.compras on delete restrict,
  tipo text not null check (tipo in ('creada', 'lineas', 'pedida', 'datos', 'recepcion', 'cerrada', 'cancelada', 'borrador')),
  descripcion text not null,
  datos jsonb not null default '{}'::jsonb,
  usuario uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index if not exists compra_eventos_compra_idx on public.compra_eventos (compra_id, id);

-- Stock entries know their purchase (existing rows untouched)
alter table public.stock_movimientos add column if not exists compra_id bigint references public.compras on delete restrict;
create index if not exists stock_movimientos_compra_idx on public.stock_movimientos (compra_id) where compra_id is not null;

-- ---------------------------------------------------------------------------
-- Views: quantities are derived, never stored twice
-- ---------------------------------------------------------------------------
-- Received = receipt lines whose stock entry has not been corrected
create or replace view public.v_compras_lineas_cantidades with (security_invoker = true) as
  select l.id as compra_linea_id, l.compra_id, l.variante_id,
    (l.para_pedidos + l.reposicion) as cantidad,
    coalesce(r.recibido, 0)::integer as recibido,
    l.cantidad_cerrada as cerrada,
    greatest(l.para_pedidos + l.reposicion - coalesce(r.recibido, 0) - l.cantidad_cerrada, 0)::integer as pendiente
  from public.compra_lineas l
  left join lateral (
    select sum(rl.cantidad) as recibido from public.compra_recepcion_lineas rl
    where rl.compra_linea_id = l.id
      and not exists (select 1 from public.stock_movimientos x where x.corrige_movimiento_id = rl.movimiento_id)
  ) r on true;

-- Units still to arrive per variant: sent purchases, plus needs marked "ya pedidas" before purchases existed
create or replace view public.v_compras_en_camino with (security_invoker = true) as
  select variante_id, sum(pendiente)::integer as pendiente
  from (
    select q.variante_id, q.pendiente from public.v_compras_lineas_cantidades q join public.compras c on c.id = q.compra_id
    where c.estado = 'pedida' and q.pendiente > 0
    union all
    select variante_id, cantidad from public.stock_necesidades where pedido_id is not null and estado = 'pedida'
  ) x
  group by variante_id;

-- Material of each order per catalogue variant (same columns as before). What
-- is on its way is shared among the active orders by nearest delivery date
-- (then order id): pendiente_recibir; the rest of what is missing is
-- pendiente_comprar. Nothing has to be "noted" any more.
create or replace view public.v_pedidos_material with (security_invoker = true) as
  with lineas as (
    select pedido_id, variante_id, sum(cantidad)::integer as necesario from public.pedido_lineas where variante_id is not null group by 1, 2
  ), reservas as (
    select r.pedido_id, a.variante_id, sum(r.cantidad)::integer as reservado
    from public.stock_reservas r join public.stock_articulos a on a.id = r.articulo_id
    where r.pedido_id is not null and r.estado = 'activa' group by 1, 2
  ), movimientos as (
    select m.pedido_id, a.variante_id,
      sum(case when m.tipo = 'salida' then -m.cantidad else 0 end)::integer as salidas,
      sum(case when m.tipo = 'devolucion' then m.cantidad else 0 end)::integer as devueltas,
      sum(case when m.tipo = 'merma' then -m.cantidad else 0 end)::integer as mermas
    from public.stock_movimientos m join public.stock_articulos a on a.id = m.articulo_id
    where m.pedido_id is not null and not exists (select 1 from public.stock_movimientos c where c.corrige_movimiento_id = m.id)
    group by 1, 2
  ), base as (
    select l.pedido_id, l.variante_id, l.necesario,
      coalesce(r.reservado, 0) as reservado,
      coalesce(m.salidas, 0) - coalesce(m.devueltas, 0) as usado,
      coalesce(m.mermas, 0) as merma,
      coalesce(m.devueltas, 0) as devuelto,
      greatest(l.necesario - coalesce(r.reservado, 0) - (coalesce(m.salidas, 0) - coalesce(m.devueltas, 0)), 0) as falta,
      case when p.estado in ('pendiente_preparar', 'pendiente_material', 'listo_produccion', 'en_produccion') then true else false end as activo,
      p.fecha_entrega
    from lineas l
    join public.pedidos p on p.id = l.pedido_id
    left join reservas r on r.pedido_id = l.pedido_id and r.variante_id = l.variante_id
    left join movimientos m on m.pedido_id = l.pedido_id and m.variante_id = l.variante_id
  ), reparto as (
    select b.*,
      case when b.activo then b.falta else 0 end as falta_activa,
      sum(case when b.activo then b.falta else 0 end) over (
        partition by b.variante_id order by b.fecha_entrega nulls last, b.pedido_id rows between unbounded preceding and current row
      ) as acumulado
    from base b
  )
  select x.pedido_id, x.variante_id, c.proveedor, c.marca, c.modelo, c.color, c.talla, c.tipo,
    x.necesario, x.reservado, x.usado, x.merma, x.devuelto, x.falta,
    coalesce(s.fisico, 0) as fisico_almacen,
    coalesce(s.fisico - s.reservado, 0) as disponible_almacen,
    (x.falta_activa - least(x.falta_activa, greatest(coalesce(e.pendiente, 0) - (x.acumulado - x.falta_activa), 0)))::integer as pendiente_comprar,
    least(x.falta_activa, greatest(coalesce(e.pendiente, 0) - (x.acumulado - x.falta_activa), 0))::integer as pendiente_recibir
  from reparto x
  join public.v_catalogo_admin c on c.variante_id = x.variante_id
  left join public.stock_articulos s on s.variante_id = x.variante_id
  left join public.v_compras_en_camino e on e.variante_id = x.variante_id;

-- What to buy per supplier variant: for orders and to restock (see header)
create or replace view public.v_compras_por_comprar with (security_invoker = true) as
  with faltas as (
    select m.variante_id, sum(m.falta)::integer as falta, count(*)::integer as pedidos, min(p.fecha_entrega) as primera_entrega
    from public.v_pedidos_material m join public.pedidos p on p.id = m.pedido_id
    where p.estado in ('pendiente_preparar', 'pendiente_material', 'listo_produccion', 'en_produccion') and m.falta > 0
    group by 1
  ), manuales as (
    select variante_id, sum(cantidad)::integer as cantidad from public.stock_necesidades where pedido_id is null and estado = 'pendiente' group by 1
  ), base as (
    select c.variante_id, c.proveedor_id, c.proveedor, c.marca, c.modelo, c.referencia, c.color, c.talla, c.tipo, c.disponible as activo,
      c.precio_neto, c.iva_porcentaje, c.coste,
      coalesce(f.falta, 0) as falta_pedidos, coalesce(f.pedidos, 0) as pedidos, f.primera_entrega,
      coalesce(s.fisico - s.reservado, 0) as disponible,
      case when s.activo then coalesce(s.stock_minimo, 0) else 0 end as stock_minimo,
      coalesce(n.cantidad, 0) as necesidades_manuales,
      coalesce(e.pendiente, 0) as en_camino
    from public.v_catalogo_admin c
    left join faltas f on f.variante_id = c.variante_id
    left join manuales n on n.variante_id = c.variante_id
    left join public.stock_articulos s on s.variante_id = c.variante_id
    left join public.v_compras_en_camino e on e.variante_id = c.variante_id
    where c.proveedor_id is not null and (f.falta > 0 or (s.activo and s.stock_minimo > 0) or n.cantidad > 0)
  ), calculo as (
    select b.*,
      greatest(b.falta_pedidos + b.stock_minimo + b.necesidades_manuales - b.disponible - b.en_camino, 0) as total,
      greatest(b.falta_pedidos - b.disponible - b.en_camino, 0) as para_pedidos_max
    from base b
  )
  select variante_id, proveedor_id, proveedor, marca, modelo, referencia, color, talla, tipo, activo, precio_neto, iva_porcentaje, coste,
    falta_pedidos, pedidos, primera_entrega, disponible, stock_minimo, necesidades_manuales, en_camino,
    least(total, para_pedidos_max)::integer as para_pedidos,
    (total - least(total, para_pedidos_max))::integer as reposicion
  from calculo
  where total > 0;

-- Orders behind each variant to buy (for "Para: P-2026/004 (6)")
create or replace view public.v_compras_por_comprar_pedidos with (security_invoker = true) as
  select m.variante_id, m.pedido_id, p.numero, p.cliente_nombre, p.fecha_entrega, m.falta, m.pendiente_comprar, m.pendiente_recibir
  from public.v_pedidos_material m join public.pedidos p on p.id = m.pedido_id
  where p.estado in ('pendiente_preparar', 'pendiente_material', 'listo_produccion', 'en_produccion') and m.falta > 0;

-- Lines with catalogue data, quantities, prices and box hints (supplier data only)
create or replace view public.v_compras_lineas with (security_invoker = true) as
  select l.id, l.compra_id, c.numero, c.estado, c.proveedor_id, l.variante_id, cat.marca, cat.modelo, coalesce(l.referencia, cat.referencia) as referencia,
    cat.color, cat.talla, cat.tipo, l.descripcion, l.orden,
    l.para_pedidos, l.reposicion, q.cantidad, q.recibido, q.cerrada, q.pendiente,
    l.precio_neto, l.iva_porcentaje,
    case when l.precio_neto is null then null else round(l.precio_neto * (100 + coalesce(l.iva_porcentaje, 0)) / 100.0, 4) end as precio_con_iva,
    (select min(t.unidades) from public.variantes_tarifas t where t.variante_id = l.variante_id and t.unidades > 1) as caja_unidades
  from public.compra_lineas l
  join public.compras c on c.id = l.compra_id
  join public.v_compras_lineas_cantidades q on q.compra_linea_id = l.id
  join public.v_catalogo_admin cat on cat.variante_id = l.variante_id;

-- Purchases with totals (cents: tax base, VAT, total; expected and real) and their visible state
create or replace view public.v_compras with (security_invoker = true) as
  with lineas as (
    select q.compra_id, sum(q.cantidad)::integer as unidades, sum(q.recibido)::integer as recibidas, sum(q.pendiente)::integer as pendientes,
      sum(q.cerrada)::integer as cerradas, count(*)::integer as lineas,
      round(sum(q.cantidad * coalesce(l.precio_neto, 0)) * 100)::bigint as base_prevista_cent,
      round(sum(q.cantidad * coalesce(l.precio_neto, 0) * coalesce(l.iva_porcentaje, 0) / 100.0) * 100)::bigint as iva_previsto_cent,
      bool_or(l.precio_neto is null) as sin_precio
    from public.v_compras_lineas_cantidades q join public.compra_lineas l on l.id = q.compra_linea_id
    group by q.compra_id
  ), reales as (
    select r.compra_id, count(distinct r.id)::integer as recepciones, max(r.fecha) as ultima_recepcion,
      round(coalesce(sum(rl.cantidad * coalesce(rl.precio_neto, 0)), 0) * 100)::bigint as base_real_cent,
      round(coalesce(sum(rl.cantidad * coalesce(rl.precio_neto, 0) * coalesce(rl.iva_porcentaje, 0) / 100.0), 0) * 100)::bigint as iva_real_cent
    from public.compra_recepciones r
    join public.compra_recepcion_lineas rl on rl.recepcion_id = r.id
    where not exists (select 1 from public.stock_movimientos x where x.corrige_movimiento_id = rl.movimiento_id)
    group by r.compra_id
  )
  select c.id, c.numero, c.proveedor_id, p.nombre as proveedor, p.web as proveedor_web, c.estado,
    case
      when c.estado <> 'pedida' then c.estado
      when coalesce(l.pendientes, 0) = 0 then 'recibida'
      when coalesce(l.recibidas, 0) > 0 then 'parcial'
      else 'pedida'
    end as situacion,
    c.referencia_proveedor, c.fecha_pedido, c.notas, c.motivo_cancelacion, c.creado_en, c.actualizado_en,
    coalesce(l.lineas, 0) as lineas, coalesce(l.unidades, 0) as unidades, coalesce(l.recibidas, 0) as recibidas,
    coalesce(l.pendientes, 0) as pendientes, coalesce(l.cerradas, 0) as cerradas,
    coalesce(l.base_prevista_cent, 0) as base_prevista_cent, coalesce(l.iva_previsto_cent, 0) as iva_previsto_cent,
    coalesce(l.base_prevista_cent, 0) + coalesce(l.iva_previsto_cent, 0) as total_previsto_cent,
    coalesce(r.base_real_cent, 0) as base_real_cent, coalesce(r.iva_real_cent, 0) as iva_real_cent,
    coalesce(r.base_real_cent, 0) + coalesce(r.iva_real_cent, 0) as total_real_cent,
    coalesce(l.sin_precio, false) as sin_precio,
    coalesce(r.recepciones, 0) as recepciones, r.ultima_recepcion
  from public.compras c
  join public.proveedores p on p.id = c.proveedor_id
  left join lineas l on l.compra_id = c.id
  left join reales r on r.compra_id = c.id;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public.siguiente_numero_compra(p_anio integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ultimo integer;
begin
  -- the counter row is locked by the upsert: two purchases never get the same number
  insert into public.contadores (serie, anio, ultimo) values ('COM', p_anio, 1)
  on conflict (serie, anio) do update set ultimo = public.contadores.ultimo + 1
  returning ultimo into v_ultimo;
  return 'C-' || p_anio || '/' || case when v_ultimo < 1000 then lpad(v_ultimo::text, 3, '0') else v_ultimo::text end;
end;
$$;

create or replace function public.compra_evento(p_compra_id bigint, p_tipo text, p_descripcion text, p_datos jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.compra_eventos (compra_id, tipo, descripcion, datos) values (p_compra_id, p_tipo, p_descripcion, coalesce(p_datos, '{}'::jsonb));
$$;

-- Locks a purchase of the owner that is in one of the given states
create or replace function public.compra_bloqueada(p_compra_id bigint, p_estados text[])
returns public.compras
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.compras where id = p_compra_id for update;
  if not found then
    raise exception 'No se encuentra la compra.' using errcode = 'P0002';
  end if;
  if not (c.estado = any (p_estados)) then
    raise exception 'La compra % está %: esta acción no se puede hacer ahora.', c.numero,
      case c.estado when 'borrador' then 'en borrador' when 'pedida' then 'pedida' else 'cancelada' end
      using errcode = 'P0001';
  end if;
  return c;
end;
$$;

-- Expected price of a variant from the catalogue: tax base and VAT % (VAT null: the price includes it)
create or replace function public.compra_precio_catalogo(p_variante_id bigint)
returns table (precio_neto numeric, iva_porcentaje numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when v.precio_neto is not null then v.precio_neto
         when v.precio_compra is not null and v.iva_porcentaje is not null then round(v.precio_compra * 100 / (100 + v.iva_porcentaje), 4)
         when v.precio_compra is not null then v.precio_compra
         else round(v.coste_cent / 100.0, 4) end,
    case when v.precio_neto is not null or v.precio_compra is not null then v.iva_porcentaje else null end
  from public.variantes v where v.id = p_variante_id;
$$;

-- Adds or updates one draft line (internal: the caller holds the purchase lock)
create or replace function public.compra_poner_linea(p_compra public.compras, p_variante_id bigint, p_para_pedidos integer, p_reposicion integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cat record;
  precio record;
begin
  select * into cat from public.v_catalogo_admin where variante_id = p_variante_id;
  if not found then
    raise exception 'Esa prenda no está en el catálogo.' using errcode = 'P0001';
  end if;
  if cat.proveedor_id is distinct from p_compra.proveedor_id then
    raise exception '% · % % no es de este proveedor.', cat.modelo, cat.color, cat.talla using errcode = 'P0001';
  end if;
  if coalesce(p_para_pedidos, 0) < 0 or coalesce(p_reposicion, 0) < 0 then
    raise exception 'Las cantidades no pueden ser negativas.' using errcode = 'P0001';
  end if;
  if coalesce(p_para_pedidos, 0) + coalesce(p_reposicion, 0) = 0 then
    delete from public.compra_lineas where compra_id = p_compra.id and variante_id = p_variante_id;
    return;
  end if;
  update public.compra_lineas set para_pedidos = p_para_pedidos, reposicion = p_reposicion
    where compra_id = p_compra.id and variante_id = p_variante_id;
  if not found then
    select * into precio from public.compra_precio_catalogo(p_variante_id);
    insert into public.compra_lineas (compra_id, variante_id, para_pedidos, reposicion, precio_neto, iva_porcentaje, descripcion, referencia, orden)
    values (p_compra.id, p_variante_id, p_para_pedidos, p_reposicion, precio.precio_neto, precio.iva_porcentaje,
            cat.modelo || ' · ' || cat.color || ' ' || cat.talla, cat.referencia,
            coalesce((select max(orden) from public.compra_lineas where compra_id = p_compra.id), 0) + 1);
  end if;
end;
$$;

-- Active orders that still miss a variant, nearest delivery first (then order id): who gets arriving units
create or replace function public.compra_candidatos(p_variante_id bigint)
returns table (pedido_id bigint, numero text, falta integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.numero, (q.necesario - q.reservado - q.usado)::integer
  from public.pedidos p
  cross join lateral public.pedido_cantidades(p.id, p_variante_id) q
  where p.estado in ('pendiente_preparar', 'pendiente_material', 'listo_produccion', 'en_produccion')
    and exists (select 1 from public.pedido_lineas l where l.pedido_id = p.id and l.variante_id = p_variante_id)
    and q.necesario - q.reservado - q.usado > 0
  order by p.fecha_entrega nulls last, p.id;
$$;

/*
 * What a receipt would do, without doing it. p_lineas = [{ compra_linea_id,
 * cantidad, precio_neto?, iva_porcentaje? }] (missing price: the expected one).
 * Returns { entradas, reservas, libres, listos, exceso }: each arriving variant
 * is shared among the orders that miss it right now, the rest stays free.
 */
create or replace function public.compra_plan_recepcion(p_compra_id bigint, p_lineas jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l record;
  cand record;
  quedan integer;
  r integer;
  entradas jsonb := '[]'::jsonb;
  reservas jsonb := '[]'::jsonb;
  libres jsonb := '[]'::jsonb;
  listos jsonb := '[]'::jsonb;
  exceso integer := 0;
  ped record;
begin
  if jsonb_typeof(coalesce(p_lineas, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de líneas no válido.' using errcode = '22023';
  end if;
  for l in
    select cl.id as compra_linea_id, cl.variante_id, cl.descripcion, q.pendiente,
      sum((x ->> 'cantidad')::integer)::integer as cantidad,
      coalesce(min(nullif(x ->> 'precio_neto', '')::numeric), min(cl.precio_neto)) as precio_neto,
      case when bool_or(x ? 'iva_porcentaje') then min(nullif(x ->> 'iva_porcentaje', '')::numeric) else min(cl.iva_porcentaje) end as iva_porcentaje
    from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x
    left join public.compra_lineas cl on cl.id = (x ->> 'compra_linea_id')::bigint and cl.compra_id = p_compra_id
    left join public.v_compras_lineas_cantidades q on q.compra_linea_id = cl.id
    group by cl.id, cl.variante_id, cl.descripcion, q.pendiente
    order by cl.variante_id
  loop
    if l.compra_linea_id is null then
      raise exception 'Una de las líneas no pertenece a esta compra.' using errcode = 'P0001';
    end if;
    if l.cantidad is null or l.cantidad < 0 then
      raise exception 'Las cantidades recibidas no pueden ser negativas.' using errcode = 'P0001';
    end if;
    if l.precio_neto is not null and l.precio_neto < 0 then
      raise exception 'El precio no puede ser negativo.' using errcode = 'P0001';
    end if;
    continue when l.cantidad = 0;
    entradas := entradas || jsonb_build_object('compra_linea_id', l.compra_linea_id, 'variante_id', l.variante_id, 'descripcion', l.descripcion,
      'cantidad', l.cantidad, 'pendiente', l.pendiente, 'exceso', greatest(l.cantidad - l.pendiente, 0),
      'precio_neto', l.precio_neto, 'iva_porcentaje', l.iva_porcentaje);
    exceso := exceso + greatest(l.cantidad - l.pendiente, 0);
    quedan := l.cantidad;
    for cand in select * from public.compra_candidatos(l.variante_id) loop
      exit when quedan = 0;
      r := least(cand.falta, quedan);
      reservas := reservas || jsonb_build_object('pedido_id', cand.pedido_id, 'numero', cand.numero, 'variante_id', l.variante_id, 'descripcion', l.descripcion, 'cantidad', r);
      quedan := quedan - r;
    end loop;
    if quedan > 0 then
      libres := libres || jsonb_build_object('variante_id', l.variante_id, 'descripcion', l.descripcion, 'cantidad', quedan);
    end if;
  end loop;

  -- Orders whose catalogue garments would all be covered, with no unlinked garments, ready to move on
  for ped in
    select distinct (x ->> 'pedido_id')::bigint as id, x ->> 'numero' as numero from jsonb_array_elements(reservas) x order by 1
  loop
    if exists (select 1 from public.pedidos p where p.id = ped.id and p.estado in ('pendiente_preparar', 'pendiente_material'))
       and not exists (select 1 from public.pedido_lineas pl where pl.pedido_id = ped.id and pl.variante_id is null)
       and not exists (
         select 1 from (select distinct variante_id from public.pedido_lineas where pedido_id = ped.id and variante_id is not null) v
         cross join lateral public.pedido_cantidades(ped.id, v.variante_id) q
         where q.necesario - q.reservado - q.usado
               - coalesce((select sum((y ->> 'cantidad')::integer) from jsonb_array_elements(reservas) y
                           where (y ->> 'pedido_id')::bigint = ped.id and (y ->> 'variante_id')::bigint = v.variante_id), 0) > 0
       ) then
      listos := listos || jsonb_build_object('pedido_id', ped.id, 'numero', ped.numero);
    end if;
  end loop;
  return jsonb_build_object('entradas', entradas, 'reservas', reservas, 'libres', libres, 'listos', listos, 'exceso', exceso);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operations for the owner (each one checks es_propietario)
-- ---------------------------------------------------------------------------
/*
 * Prepares the supplier's draft from "por comprar": creates it if there is
 * none, otherwise refreshes it. Idempotent: lines for orders take the current
 * amounts; restocking amounts already in the draft (changed or added by hand)
 * are kept; new variants come with the proposed restocking.
 */
create or replace function public.compra_preparar(p_proveedor_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
  v record;
  nueva boolean := false;
  existente public.compra_lineas;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform 1 from public.proveedores where id = p_proveedor_id for update; -- one preparation per supplier at a time
  if not found then
    raise exception 'No se encuentra el proveedor.' using errcode = 'P0002';
  end if;
  select * into c from public.compras where proveedor_id = p_proveedor_id and estado = 'borrador' for update;
  if not found then
    insert into public.compras (numero, proveedor_id) values (public.siguiente_numero_compra(extract(year from current_date)::integer), p_proveedor_id)
    returning * into c;
    nueva := true;
  end if;
  -- variants no longer needed by orders keep only their restocking amount
  update public.compra_lineas l set para_pedidos = 0
    where l.compra_id = c.id and l.para_pedidos > 0
      and not exists (select 1 from public.v_compras_por_comprar p where p.variante_id = l.variante_id and p.para_pedidos > 0);
  delete from public.compra_lineas where compra_id = c.id and para_pedidos = 0 and reposicion = 0;
  for v in select * from public.v_compras_por_comprar where proveedor_id = p_proveedor_id order by modelo, color, variante_id loop
    select * into existente from public.compra_lineas where compra_id = c.id and variante_id = v.variante_id;
    perform public.compra_poner_linea(c, v.variante_id, v.para_pedidos, case when existente.id is null then v.reposicion else existente.reposicion end);
    existente := null;
  end loop;
  update public.compras set actualizado_en = now() where id = c.id;
  perform public.compra_evento(c.id, case when nueva then 'creada' else 'lineas' end,
    case when nueva then 'Compra preparada con lo que hay por comprar' else 'Borrador actualizado con lo que hay por comprar' end,
    jsonb_build_object('unidades', (select coalesce(sum(para_pedidos + reposicion), 0) from public.compra_lineas where compra_id = c.id)));
  return c.id;
end;
$$;

-- Draft lines as the owner leaves them: p_lineas = [{ variante_id, para_pedidos, reposicion }]; zero removes a line
create or replace function public.compra_guardar_lineas(p_compra_id bigint, p_lineas jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
  l record;
begin
  c := public.compra_bloqueada(p_compra_id, array['borrador']);
  if jsonb_typeof(coalesce(p_lineas, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de líneas no válido.' using errcode = '22023';
  end if;
  for l in
    select (x ->> 'variante_id')::bigint as variante_id, coalesce((x ->> 'para_pedidos')::integer, 0) as para_pedidos, coalesce((x ->> 'reposicion')::integer, 0) as reposicion
    from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x order by 1
  loop
    perform public.compra_poner_linea(c, l.variante_id, l.para_pedidos, l.reposicion);
  end loop;
  update public.compras set actualizado_en = now() where id = c.id;
  perform public.compra_evento(c.id, 'lineas', 'Prendas de la compra modificadas', jsonb_build_object('lineas', jsonb_array_length(coalesce(p_lineas, '[]'::jsonb))));
end;
$$;

-- Bought on the supplier's website: the draft becomes "pedida". Repeating it changes nothing.
create or replace function public.compra_marcar_pedida(p_compra_id bigint, p_referencia text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
begin
  c := public.compra_bloqueada(p_compra_id, array['borrador', 'pedida']);
  if c.estado = 'pedida' then
    return; -- double click or retry
  end if;
  if not exists (select 1 from public.compra_lineas where compra_id = c.id) then
    raise exception 'La compra no tiene prendas.' using errcode = 'P0001';
  end if;
  update public.compras set estado = 'pedida', fecha_pedido = current_date, referencia_proveedor = coalesce(nullif(trim(p_referencia), ''), referencia_proveedor),
    actualizado_en = now() where id = c.id;
  perform public.compra_evento(c.id, 'pedida', 'Marcada como pedida al proveedor' || coalesce(' (ref. ' || nullif(trim(p_referencia), '') || ')', ''),
    jsonb_build_object('referencia', nullif(trim(p_referencia), '')));
end;
$$;

-- p_datos: any of { referencia_proveedor, notas } (present keys are set)
create or replace function public.compra_actualizar(p_compra_id bigint, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
begin
  c := public.compra_bloqueada(p_compra_id, array['borrador', 'pedida']);
  update public.compras set
    referencia_proveedor = case when p_datos ? 'referencia_proveedor' then nullif(trim(p_datos ->> 'referencia_proveedor'), '') else referencia_proveedor end,
    notas = case when p_datos ? 'notas' then nullif(trim(p_datos ->> 'notas'), '') else notas end,
    actualizado_en = now()
  where id = c.id;
  perform public.compra_evento(c.id, 'datos', 'Referencia o notas actualizadas');
end;
$$;

-- Marked as ordered by mistake: back to draft while nothing has arrived and there is no other draft
create or replace function public.compra_volver_borrador(p_compra_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
begin
  c := public.compra_bloqueada(p_compra_id, array['pedida']);
  if exists (select 1 from public.v_compras_lineas_cantidades where compra_id = c.id and (recibido > 0 or cerrada > 0)) then
    raise exception 'Ya ha llegado mercancía de esta compra: no puede volver a borrador.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.compras where proveedor_id = c.proveedor_id and estado = 'borrador') then
    raise exception 'Este proveedor ya tiene otro borrador: termina o descarta ese primero.' using errcode = 'P0001';
  end if;
  update public.compras set estado = 'borrador', fecha_pedido = null, actualizado_en = now() where id = c.id;
  perform public.compra_evento(c.id, 'borrador', 'Vuelve a borrador');
end;
$$;

-- A draft that is not needed: cancelled (keeps its number and history)
create or replace function public.compra_descartar(p_compra_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
begin
  c := public.compra_bloqueada(p_compra_id, array['borrador']);
  update public.compras set estado = 'cancelada', motivo_cancelacion = 'Borrador descartado', actualizado_en = now() where id = c.id;
  perform public.compra_evento(c.id, 'cancelada', 'Borrador descartado');
end;
$$;

-- An ordered purchase that will not come at all (nothing arrived yet): cancelled with a reason
create or replace function public.compra_cancelar(p_compra_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
begin
  c := public.compra_bloqueada(p_compra_id, array['pedida']);
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indica por qué se cancela la compra.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.v_compras_lineas_cantidades where compra_id = c.id and recibido > 0) then
    raise exception 'Ya ha llegado parte de esta compra: usa «Dar por cerrado lo pendiente».' using errcode = 'P0001';
  end if;
  update public.compras set estado = 'cancelada', motivo_cancelacion = trim(p_motivo), actualizado_en = now() where id = c.id;
  perform public.compra_evento(c.id, 'cancelada', 'Compra cancelada: ' || trim(p_motivo));
end;
$$;

-- What has not arrived will not arrive (out of stock...): the pending units are given up and go back to "por comprar"
create or replace function public.compra_cerrar_pendiente(p_compra_id bigint, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
  v_total integer;
begin
  c := public.compra_bloqueada(p_compra_id, array['pedida']);
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indica por qué no llegará lo pendiente.' using errcode = 'P0001';
  end if;
  select coalesce(sum(pendiente), 0) into v_total from public.v_compras_lineas_cantidades where compra_id = c.id;
  if v_total = 0 then
    raise exception 'No queda nada pendiente de llegar.' using errcode = 'P0001';
  end if;
  update public.compra_lineas l set cantidad_cerrada = l.cantidad_cerrada + q.pendiente
    from public.v_compras_lineas_cantidades q where q.compra_linea_id = l.id and l.compra_id = c.id and q.pendiente > 0;
  update public.compras set actualizado_en = now() where id = c.id;
  perform public.compra_evento(c.id, 'cerrada', v_total || ' prendas no llegarán: ' || trim(p_motivo), jsonb_build_object('unidades', v_total));
  return v_total;
end;
$$;

-- Read-only preview of a receipt, for the confirmation
create or replace function public.compra_previsualizar_recepcion(p_compra_id bigint, p_lineas jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.compras;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.compras where id = p_compra_id;
  if not found then
    raise exception 'No se encuentra la compra.' using errcode = 'P0002';
  end if;
  if c.estado <> 'pedida' then
    raise exception 'Solo se registran llegadas de compras pedidas.' using errcode = 'P0001';
  end if;
  return public.compra_plan_recepcion(c.id, p_lineas);
end;
$$;

/*
 * Records a receipt atomically: stock entries, reservations for orders, closed
 * needs and orders ready for production. p_clave identifies the request (the
 * same key again returns the first result and records nothing). p_esperado:
 * the reservations the owner confirmed ([{ pedido_id, variante_id, cantidad }]);
 * if the orders changed meanwhile, nothing is done (40001). p_confirmar_exceso:
 * units over what is pending were checked and are correct (they stay free).
 */
create or replace function public.compra_recibir(p_compra_id bigint, p_clave uuid, p_lineas jsonb, p_esperado jsonb,
                                                 p_fecha date default null, p_albaran text default null, p_confirmar_exceso boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compras;
  previa public.compra_recepciones;
  plan jsonb;
  e jsonb;
  r jsonb;
  a public.stock_articulos;
  v_recepcion bigint;
  v_movimiento bigint;
  v_reserva bigint;
  v_referencia text;
  v_total integer := 0;
  v_resumen jsonb;
  ped record;
begin
  if p_clave is null then
    raise exception 'Falta la clave de la recepción.' using errcode = '22023';
  end if;
  c := public.compra_bloqueada(p_compra_id, array['borrador', 'pedida', 'cancelada']); -- repeated requests wait here
  select * into previa from public.compra_recepciones where clave = p_clave;
  if found then
    if previa.compra_id <> c.id then
      raise exception 'Clave de recepción repetida.' using errcode = '22023';
    end if;
    return previa.resumen || jsonb_build_object('repetida', true);
  end if;
  if c.estado <> 'pedida' then
    raise exception 'Solo se registran llegadas de compras pedidas.' using errcode = 'P0001';
  end if;
  -- lock the orders that could receive units (fixed order), so nobody changes them meanwhile
  perform 1 from public.pedidos p
    where p.estado in ('pendiente_preparar', 'pendiente_material', 'listo_produccion', 'en_produccion')
      and exists (select 1 from public.pedido_lineas pl join public.compra_lineas cl on cl.variante_id = pl.variante_id
                  where pl.pedido_id = p.id and cl.compra_id = c.id)
    order by p.id for update;
  plan := public.compra_plan_recepcion(c.id, p_lineas);
  if jsonb_array_length(plan -> 'entradas') = 0 then
    raise exception 'Indica cuántas prendas han llegado.' using errcode = 'P0001';
  end if;
  if (plan ->> 'exceso')::integer > 0 and not coalesce(p_confirmar_exceso, false) then
    raise exception 'Han llegado % prendas más de las pendientes: revísalo y confírmalo.', plan ->> 'exceso' using errcode = 'P0001';
  end if;
  if (select coalesce(jsonb_agg(jsonb_build_object('pedido_id', (x ->> 'pedido_id')::bigint, 'variante_id', (x ->> 'variante_id')::bigint, 'cantidad', (x ->> 'cantidad')::integer)
                                order by (x ->> 'variante_id')::bigint, (x ->> 'pedido_id')::bigint), '[]'::jsonb)
      from jsonb_array_elements(plan -> 'reservas') x)
     is distinct from
     (select coalesce(jsonb_agg(jsonb_build_object('pedido_id', (x ->> 'pedido_id')::bigint, 'variante_id', (x ->> 'variante_id')::bigint, 'cantidad', (x ->> 'cantidad')::integer)
                                order by (x ->> 'variante_id')::bigint, (x ->> 'pedido_id')::bigint), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_esperado, '[]'::jsonb)) x) then
    raise exception 'Los pedidos han cambiado desde que se mostró el resumen: revísalo de nuevo.' using errcode = '40001';
  end if;

  insert into public.compra_recepciones (compra_id, clave, fecha, albaran)
  values (c.id, p_clave, coalesce(p_fecha, current_date), nullif(trim(p_albaran), '')) returning id into v_recepcion;
  v_referencia := c.numero || coalesce(' · albarán ' || nullif(trim(p_albaran), ''), '');

  -- one stock entry per line, items locked in variant order
  for e in select * from jsonb_array_elements(plan -> 'entradas') order by (value ->> 'variante_id')::bigint loop
    a := public.stock_articulo_bloqueado((e ->> 'variante_id')::bigint, true);
    insert into public.stock_movimientos (articulo_id, tipo, cantidad, fecha, motivo, referencia, coste_unitario, compra_id)
    values (a.id, 'entrada', (e ->> 'cantidad')::integer, coalesce(p_fecha, current_date), 'Llegada de la compra ' || c.numero, v_referencia,
            case when e ->> 'precio_neto' is null then null
                 else round((e ->> 'precio_neto')::numeric * (100 + coalesce((e ->> 'iva_porcentaje')::numeric, 0)) / 100.0, 6) end,
            c.id)
    returning id into v_movimiento;
    update public.stock_articulos set fisico = fisico + (e ->> 'cantidad')::integer where id = a.id;
    insert into public.compra_recepcion_lineas (recepcion_id, compra_linea_id, cantidad, precio_neto, iva_porcentaje, movimiento_id)
    values (v_recepcion, (e ->> 'compra_linea_id')::bigint, (e ->> 'cantidad')::integer, nullif(e ->> 'precio_neto', '')::numeric,
            nullif(e ->> 'iva_porcentaje', '')::numeric, v_movimiento);
    v_total := v_total + (e ->> 'cantidad')::integer;
  end loop;

  -- reservations for the orders (the item rows are already locked by this transaction)
  for r in select * from jsonb_array_elements(plan -> 'reservas') order by (value ->> 'variante_id')::bigint, (value ->> 'pedido_id')::bigint loop
    select * into a from public.stock_articulos where variante_id = (r ->> 'variante_id')::bigint for update;
    v_reserva := null;
    update public.stock_reservas set cantidad = cantidad + (r ->> 'cantidad')::integer
      where articulo_id = a.id and pedido_id = (r ->> 'pedido_id')::bigint and estado = 'activa'
      returning id into v_reserva;
    if v_reserva is null then
      insert into public.stock_reservas (articulo_id, cantidad, referencia, pedido_id, motivo)
      values (a.id, (r ->> 'cantidad')::integer, r ->> 'numero', (r ->> 'pedido_id')::bigint, 'Reserva al llegar la compra ' || c.numero);
    end if;
    update public.stock_articulos set reservado = reservado + (r ->> 'cantidad')::integer where id = a.id; -- checked: reservado <= fisico
  end loop;

  for ped in
    select (x ->> 'pedido_id')::bigint as id, sum((x ->> 'cantidad')::integer)::integer as cantidad from jsonb_array_elements(plan -> 'reservas') x group by 1 order by 1
  loop
    perform public.pedido_evento(ped.id, 'reserva', ped.cantidad || ' prendas reservadas al llegar la compra ' || c.numero,
      jsonb_build_object('compra_id', c.id, 'recepcion_id', v_recepcion, 'automatico', true));
    perform public.pedido_actualizar_necesidades(ped.id, false);
  end loop;
  for ped in select (x ->> 'pedido_id')::bigint as id from jsonb_array_elements(plan -> 'listos') x order by 1 loop
    perform public.pedido_cambiar_estado(ped.id, 'listo_produccion', 'Material completo al llegar la compra ' || c.numero);
  end loop;

  v_resumen := plan || jsonb_build_object('recepcion_id', v_recepcion, 'compra', c.numero, 'unidades', v_total);
  update public.compra_recepciones set resumen = v_resumen where id = v_recepcion;
  update public.compras set actualizado_en = now() where id = c.id;
  perform public.compra_evento(c.id, 'recepcion',
    'Llegada registrada: ' || v_total || ' prendas' || coalesce(' (albarán ' || nullif(trim(p_albaran), '') || ')', ''), v_resumen);
  return v_resumen;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------
alter table public.compras enable row level security;
alter table public.compra_lineas enable row level security;
alter table public.compra_recepciones enable row level security;
alter table public.compra_recepcion_lineas enable row level security;
alter table public.compra_eventos enable row level security;
drop policy if exists compras_lectura on public.compras;
drop policy if exists compra_lineas_lectura on public.compra_lineas;
drop policy if exists compra_recepciones_lectura on public.compra_recepciones;
drop policy if exists compra_recepcion_lineas_lectura on public.compra_recepcion_lineas;
drop policy if exists compra_eventos_lectura on public.compra_eventos;
create policy compras_lectura on public.compras for select to authenticated using (public.es_propietario());
create policy compra_lineas_lectura on public.compra_lineas for select to authenticated using (public.es_propietario());
create policy compra_recepciones_lectura on public.compra_recepciones for select to authenticated using (public.es_propietario());
create policy compra_recepcion_lineas_lectura on public.compra_recepcion_lineas for select to authenticated using (public.es_propietario());
create policy compra_eventos_lectura on public.compra_eventos for select to authenticated using (public.es_propietario());

-- Read only for the app: every change goes through the functions (which check the owner)
revoke all on public.compras, public.compra_lineas, public.compra_recepciones, public.compra_recepcion_lineas, public.compra_eventos from anon, authenticated;
grant select on public.compras, public.compra_lineas, public.compra_recepciones, public.compra_recepcion_lineas, public.compra_eventos to authenticated;
grant select on public.compras, public.compra_lineas, public.compra_recepciones, public.compra_recepcion_lineas, public.compra_eventos to service_role;
revoke all on public.v_compras_lineas_cantidades, public.v_compras_en_camino, public.v_compras_por_comprar, public.v_compras_por_comprar_pedidos,
  public.v_compras_lineas, public.v_compras, public.v_pedidos_material from anon;
grant select on public.v_compras_lineas_cantidades, public.v_compras_en_camino, public.v_compras_por_comprar, public.v_compras_por_comprar_pedidos,
  public.v_compras_lineas, public.v_compras, public.v_pedidos_material to authenticated;
grant select on public.v_compras_lineas_cantidades, public.v_compras_en_camino, public.v_compras_por_comprar, public.v_compras_por_comprar_pedidos,
  public.v_compras_lineas, public.v_compras, public.v_pedidos_material to service_role;

-- Internal helpers: not callable from the API
revoke execute on function public.siguiente_numero_compra(integer) from anon, authenticated, public;
revoke execute on function public.compra_evento(bigint, text, text, jsonb) from anon, authenticated, public;
revoke execute on function public.compra_bloqueada(bigint, text[]) from anon, authenticated, public;
revoke execute on function public.compra_precio_catalogo(bigint) from anon, authenticated, public;
revoke execute on function public.compra_poner_linea(public.compras, bigint, integer, integer) from anon, authenticated, public;
revoke execute on function public.compra_candidatos(bigint) from anon, authenticated, public;
revoke execute on function public.compra_plan_recepcion(bigint, jsonb) from anon, authenticated, public;

-- Operations for the owner
revoke execute on function public.compra_preparar(bigint) from anon, public;
revoke execute on function public.compra_guardar_lineas(bigint, jsonb) from anon, public;
revoke execute on function public.compra_marcar_pedida(bigint, text) from anon, public;
revoke execute on function public.compra_actualizar(bigint, jsonb) from anon, public;
revoke execute on function public.compra_volver_borrador(bigint) from anon, public;
revoke execute on function public.compra_descartar(bigint) from anon, public;
revoke execute on function public.compra_cancelar(bigint, text) from anon, public;
revoke execute on function public.compra_cerrar_pendiente(bigint, text) from anon, public;
revoke execute on function public.compra_previsualizar_recepcion(bigint, jsonb) from anon, public;
revoke execute on function public.compra_recibir(bigint, uuid, jsonb, jsonb, date, text, boolean) from anon, public;
grant execute on function public.compra_preparar(bigint) to authenticated;
grant execute on function public.compra_guardar_lineas(bigint, jsonb) to authenticated;
grant execute on function public.compra_marcar_pedida(bigint, text) to authenticated;
grant execute on function public.compra_actualizar(bigint, jsonb) to authenticated;
grant execute on function public.compra_volver_borrador(bigint) to authenticated;
grant execute on function public.compra_descartar(bigint) to authenticated;
grant execute on function public.compra_cancelar(bigint, text) to authenticated;
grant execute on function public.compra_cerrar_pendiente(bigint, text) to authenticated;
grant execute on function public.compra_previsualizar_recepcion(bigint, jsonb) to authenticated;
grant execute on function public.compra_recibir(bigint, uuid, jsonb, jsonb, date, text, boolean) to authenticated;
