-- Workshop orders, linked to quotes, customers, the catalogue and the inventory.
--
-- * An order has its own number (P-YYYY/NNN, independent of the quote number),
--   a PHYSICAL state (preparation -> production -> delivery) and a separate
--   PAYMENT state. The quote's economic data is copied once as a historical
--   snapshot: later price-list or parameter changes never alter it.
-- * At most one active (not cancelled) order per quote.
-- * Inventory is the existing one: reservations, movements and needs now carry
--   the order. Reserving never moves physical stock; consuming does, and a
--   partial consumption splits the reservation (the consumed part is closed),
--   so the same units are never counted twice. Merma (spoiled) and returns are
--   recorded against the order. Every quantity change locks the stock item.
-- * Orders change only through the functions below (owner only), which keep
--   an activity log (pedido_eventos) that a calendar or Kanban can use later.
-- * The quote's state follows the order (en_produccion, finalizado, cobrado).
--
-- Safety: adds tables, columns, views and functions; widens one check (needs
-- can be "pedida": ordered from the supplier, pending receipt). Existing
-- catalogue, quotes and stock rows are not changed. Re-runnable.

create table if not exists public.pedidos (
  id bigint generated always as identity primary key,
  numero text not null unique,
  presupuesto_id bigint references public.presupuestos on delete restrict,
  cliente_id bigint references public.clientes on delete restrict,
  cliente_nombre text not null check (length(trim(cliente_nombre)) > 0),
  cliente_datos jsonb not null default '{}'::jsonb check (jsonb_typeof(cliente_datos) = 'object'),
  estado text not null default 'pendiente_preparar'
    check (estado in ('pendiente_preparar', 'pendiente_material', 'listo_produccion', 'en_produccion', 'terminado', 'entregado', 'cancelado')),
  cobro_estado text not null default 'pendiente' check (cobro_estado in ('pendiente', 'parcial', 'cobrado')),
  importe_cobrado_cent bigint not null default 0 check (importe_cobrado_cent >= 0),
  precio_acordado_cent bigint not null check (precio_acordado_cent >= 0),
  coste_previsto_cent bigint,
  economico jsonb not null default '{}'::jsonb check (jsonb_typeof(economico) = 'object'), -- snapshot of the quote's figures
  trabajo jsonb not null default '{}'::jsonb check (jsonb_typeof(trabajo) = 'object'),     -- technique, print zones and colours
  fecha_entrega date,
  fecha_inicio_prevista date,
  notas_internas text,
  instrucciones text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists pedidos_presupuesto_activo on public.pedidos (presupuesto_id) where presupuesto_id is not null and estado <> 'cancelado';
create index if not exists pedidos_estado_idx on public.pedidos (estado, fecha_entrega);

create table if not exists public.pedido_lineas (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos on delete restrict,
  variante_id bigint references public.variantes on delete restrict, -- null: garment not linked to the catalogue
  descripcion text not null check (length(trim(descripcion)) > 0),
  cantidad integer not null check (cantidad > 0),
  coste_unitario_previsto numeric(14, 6),
  orden integer not null default 0
);
create index if not exists pedido_lineas_pedido_idx on public.pedido_lineas (pedido_id);

create table if not exists public.pedido_eventos (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos on delete restrict,
  tipo text not null check (tipo in ('creado', 'estado', 'fechas', 'datos', 'lineas', 'reserva', 'liberacion', 'consumo', 'merma', 'devolucion', 'necesidad', 'cobro')),
  descripcion text not null,
  datos jsonb not null default '{}'::jsonb,
  usuario uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index if not exists pedido_eventos_pedido_idx on public.pedido_eventos (pedido_id, id);

-- Inventory links to orders (existing rows untouched)
alter table public.stock_reservas drop constraint if exists stock_reservas_pedido_fkey;
alter table public.stock_reservas add constraint stock_reservas_pedido_fkey foreign key (pedido_id) references public.pedidos on delete restrict not valid;
alter table public.stock_movimientos add column if not exists pedido_id bigint references public.pedidos on delete restrict;
alter table public.stock_movimientos add column if not exists reserva_id bigint references public.stock_reservas on delete restrict;
alter table public.stock_necesidades add column if not exists pedido_id bigint references public.pedidos on delete restrict;
alter table public.stock_necesidades drop constraint if exists stock_necesidades_estado_check;
alter table public.stock_necesidades add constraint stock_necesidades_estado_check check (estado in ('pendiente', 'pedida', 'atendida', 'cancelada'));
create unique index if not exists stock_necesidad_abierta_pedido on public.stock_necesidades (pedido_id, variante_id) where pedido_id is not null and estado in ('pendiente', 'pedida');
create index if not exists stock_reservas_pedido_idx on public.stock_reservas (pedido_id) where pedido_id is not null;
create index if not exists stock_movimientos_pedido_idx on public.stock_movimientos (pedido_id) where pedido_id is not null;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
create or replace function public.pedido_transicion_permitida(p_desde text, p_hasta text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_desde, p_hasta) in (
    ('pendiente_preparar', 'pendiente_material'), ('pendiente_preparar', 'listo_produccion'), ('pendiente_preparar', 'cancelado'),
    ('pendiente_material', 'listo_produccion'), ('pendiente_material', 'pendiente_preparar'), ('pendiente_material', 'cancelado'),
    ('listo_produccion', 'en_produccion'), ('listo_produccion', 'pendiente_material'), ('listo_produccion', 'cancelado'),
    ('en_produccion', 'terminado'), ('en_produccion', 'listo_produccion'), ('en_produccion', 'cancelado'),
    ('terminado', 'entregado'), ('terminado', 'en_produccion'),
    ('entregado', 'terminado'),
    ('cancelado', 'pendiente_preparar')
  );
$$;

create or replace function public.siguiente_numero_pedido(p_anio integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ultimo integer;
begin
  -- the counter row is locked by the upsert: two orders never get the same number
  insert into public.contadores (serie, anio, ultimo) values ('PED', p_anio, 1)
  on conflict (serie, anio) do update set ultimo = public.contadores.ultimo + 1
  returning ultimo into v_ultimo;
  return 'P-' || p_anio || '/' || case when v_ultimo < 1000 then lpad(v_ultimo::text, 3, '0') else v_ultimo::text end;
end;
$$;

create or replace function public.pedido_evento(p_pedido_id bigint, p_tipo text, p_descripcion text, p_datos jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pedido_eventos (pedido_id, tipo, descripcion, datos) values (p_pedido_id, p_tipo, p_descripcion, coalesce(p_datos, '{}'::jsonb));
$$;

-- Locks an order the owner can change (not cancelled unless allowed)
create or replace function public.pedido_bloqueado(p_pedido_id bigint, p_permitir_cerrado boolean default false)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into p from public.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if not p_permitir_cerrado and p.estado in ('cancelado', 'entregado') then
    raise exception 'The order is %: reopen it first', p.estado using errcode = '22023';
  end if;
  return p;
end;
$$;

-- Units of one variant for one order: needed, reserved, used (out minus returned), spoiled
create or replace function public.pedido_cantidades(p_pedido_id bigint, p_variante_id bigint)
returns table (necesario integer, reservado integer, usado integer, merma integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(l.cantidad) from public.pedido_lineas l where l.pedido_id = p_pedido_id and l.variante_id = p_variante_id), 0)::integer,
    coalesce((select sum(r.cantidad) from public.stock_reservas r join public.stock_articulos a on a.id = r.articulo_id
              where r.pedido_id = p_pedido_id and a.variante_id = p_variante_id and r.estado = 'activa'), 0)::integer,
    coalesce((select sum(case when m.tipo = 'salida' then -m.cantidad when m.tipo = 'devolucion' then -m.cantidad else 0 end)
              from public.stock_movimientos m join public.stock_articulos a on a.id = m.articulo_id
              where m.pedido_id = p_pedido_id and a.variante_id = p_variante_id
                and not exists (select 1 from public.stock_movimientos c where c.corrige_movimiento_id = m.id)), 0)::integer,
    coalesce((select sum(-m.cantidad) from public.stock_movimientos m join public.stock_articulos a on a.id = m.articulo_id
              where m.pedido_id = p_pedido_id and a.variante_id = p_variante_id and m.tipo = 'merma'
                and not exists (select 1 from public.stock_movimientos c where c.corrige_movimiento_id = m.id)), 0)::integer;
$$;

/*
 * Keeps the order's open purchase need per variant equal to what is still
 * missing (needed - reserved - used). p_crear: also open needs that do not
 * exist yet (only when the owner asks for it). Covered needs are closed.
 */
create or replace function public.pedido_actualizar_necesidades(p_pedido_id bigint, p_crear boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  q record;
  falta integer;
  p public.pedidos;
begin
  select * into p from public.pedidos where id = p_pedido_id;
  for v in select distinct variante_id from public.pedido_lineas where pedido_id = p_pedido_id and variante_id is not null
           union select variante_id from public.stock_necesidades where pedido_id = p_pedido_id and estado in ('pendiente', 'pedida') loop
    select * into q from public.pedido_cantidades(p_pedido_id, v.variante_id);
    falta := case when p.estado = 'cancelado' then 0 else greatest(q.necesario - q.reservado - q.usado, 0) end;
    if falta > 0 then
      update public.stock_necesidades set cantidad = falta
        where pedido_id = p_pedido_id and variante_id = v.variante_id and estado in ('pendiente', 'pedida');
      if not found and p_crear then
        insert into public.stock_necesidades (variante_id, cantidad, referencia, pedido_id) values (v.variante_id, falta, p.numero, p_pedido_id);
      end if;
    else
      update public.stock_necesidades set estado = case when p.estado = 'cancelado' then 'cancelada' else 'atendida' end
        where pedido_id = p_pedido_id and variante_id = v.variante_id and estado in ('pendiente', 'pedida');
    end if;
  end loop;
end;
$$;

-- The quote follows the order: en_produccion, finalizado, cobrado (step by step, only allowed steps)
create or replace function public.pedido_sincronizar_presupuesto(p_pedido_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  q public.presupuestos;
  objetivo text;
  orden constant text[] := array['aceptado', 'en_produccion', 'finalizado', 'cobrado'];
  i integer;
  j integer;
  siguiente text;
begin
  select * into p from public.pedidos where id = p_pedido_id;
  if p.presupuesto_id is null then
    return;
  end if;
  objetivo := case
    when p.estado in ('terminado', 'entregado') and p.cobro_estado = 'cobrado' then 'cobrado'
    when p.estado in ('terminado', 'entregado') then 'finalizado'
    when p.estado = 'en_produccion' then 'en_produccion'
    when p.estado in ('pendiente_preparar', 'pendiente_material', 'listo_produccion') then 'aceptado'
    else null end; -- a cancelled order leaves the quote as it is
  if objetivo is null then
    return;
  end if;
  for k in 1..3 loop
    select * into q from public.presupuestos where id = p.presupuesto_id for update;
    i := array_position(orden, q.estado);
    j := array_position(orden, objetivo);
    exit when i is null or i = j;
    siguiente := orden[i + sign(j - i)::integer];
    exit when not public.transicion_presupuesto_permitida(q.estado, siguiente);
    update public.presupuestos
      set estado = siguiente, historial_estados = historial_estados || jsonb_build_object('estado', siguiente, 'en', now(), 'origen', p.numero)
      where id = q.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating orders
-- ---------------------------------------------------------------------------
/*
 * From an accepted quote: customer, lines, print zones and the economic
 * snapshot are copied from the quote itself (nothing is typed again).
 * p_datos: { fecha_entrega, fecha_inicio_prevista, notas_internas, instrucciones }
 */
create or replace function public.crear_pedido_desde_presupuesto(p_presupuesto_id bigint, p_datos jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.presupuestos;
  v_id bigint;
  v_numero text;
  l record;
  v_variante bigint;
  v_cantidad integer;
  v_n integer := 0;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into q from public.presupuestos where id = p_presupuesto_id for update; -- two conversions of the same quote wait for each other
  if not found then
    raise exception 'Quote not found' using errcode = 'P0002';
  end if;
  if q.estado not in ('aceptado', 'en_produccion', 'finalizado', 'cobrado') then
    raise exception 'Only an accepted quote can become an order (state: %)', q.estado using errcode = '22023';
  end if;
  if exists (select 1 from public.pedidos where presupuesto_id = q.id and estado <> 'cancelado') then
    raise exception 'This quote already has an order' using errcode = '23505';
  end if;
  v_numero := public.siguiente_numero_pedido(extract(year from current_date)::integer);
  insert into public.pedidos (numero, presupuesto_id, cliente_id, cliente_nombre, cliente_datos, precio_acordado_cent, coste_previsto_cent,
                              economico, trabajo, fecha_entrega, fecha_inicio_prevista, notas_internas, instrucciones)
  values (v_numero, q.id, q.cliente_id, q.cliente_nombre, q.cliente_datos, coalesce(q.precio_final_cent, q.total_cent), q.coste_total_cent,
          jsonb_build_object('presupuesto_numero', q.numero, 'presupuesto_version', q.version, 'motor', q.motor, 'parametros_version', q.parametros_version,
                             'total_cent', q.total_cent, 'coste_total_cent', q.coste_total_cent, 'precio_recomendado_cent', q.precio_recomendado_cent,
                             'precio_final_cent', q.precio_final_cent, 'beneficio_cent', q.beneficio_cent, 'resultado', q.resultado,
                             'lineas', coalesce(q.entrada -> 'lineas', '[]'::jsonb), 'entrada_motor', q.entrada -> 'motor'),
          jsonb_build_object('tecnica', q.tecnica, 'zonas', coalesce(q.entrada -> 'formulario' -> 'zonas', '[]'::jsonb),
                             'minutos_diseno', q.entrada -> 'formulario' -> 'minutosDiseno', 'merma_porcentaje', q.entrada -> 'formulario' -> 'mermaPorcentaje'),
          nullif(p_datos ->> 'fecha_entrega', '')::date, nullif(p_datos ->> 'fecha_inicio_prevista', '')::date,
          nullif(trim(p_datos ->> 'notas_internas'), ''), nullif(trim(p_datos ->> 'instrucciones'), ''))
  returning id into v_id;

  for l in
    select f.linea, d.detalle, f.n
    from jsonb_array_elements(coalesce(q.entrada -> 'formulario' -> 'lineas', '[]'::jsonb)) with ordinality as f (linea, n)
    left join jsonb_array_elements(coalesce(q.entrada -> 'lineas', '[]'::jsonb)) with ordinality as d (detalle, n) using (n)
  loop
    v_cantidad := floor(coalesce(nullif(l.linea ->> 'quantity', '')::numeric, (l.detalle ->> 'cantidad')::numeric, 0))::integer;
    continue when v_cantidad <= 0;
    v_variante := case when (l.linea ->> 'productoId') ~ '^\d+$' then (l.linea ->> 'productoId')::bigint end;
    if v_variante is not null and not exists (select 1 from public.variantes where id = v_variante) then
      v_variante := null;
    end if;
    insert into public.pedido_lineas (pedido_id, variante_id, descripcion, cantidad, coste_unitario_previsto, orden)
    values (v_id, v_variante,
            coalesce(nullif(concat_ws(' · ', nullif(l.detalle ->> 'descripcion', ''), nullif(concat_ws(' ', l.detalle ->> 'color', l.detalle ->> 'talla'), '')), ''),
                     nullif(concat_ws(' · ', l.linea ->> 'modelo', l.linea ->> 'color', l.linea ->> 'size'), ''), 'Prenda'),
            v_cantidad, nullif(l.detalle ->> 'precioUnitario', '')::numeric, l.n);
    v_n := v_n + 1;
  end loop;
  perform public.pedido_evento(v_id, 'creado', 'Pedido creado desde el presupuesto ' || coalesce(q.numero, '(sin número)'),
                               jsonb_build_object('presupuesto_id', q.id, 'lineas', v_n, 'precio_acordado_cent', coalesce(q.precio_final_cent, q.total_cent)));
  return v_id;
end;
$$;

/*
 * Without a quote. p_datos: { cliente_id?, cliente_nombre, precio_acordado_cent, coste_previsto_cent?,
 *   fecha_entrega?, fecha_inicio_prevista?, notas_internas?, instrucciones?, trabajo?,
 *   lineas: [{ variante_id?, descripcion, cantidad, coste_unitario_previsto? }] }
 */
create or replace function public.crear_pedido(p_datos jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  c public.clientes;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if nullif(p_datos ->> 'cliente_id', '') is not null then
    select * into c from public.clientes where id = (p_datos ->> 'cliente_id')::bigint;
    if not found then
      raise exception 'Customer not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.pedidos (numero, cliente_id, cliente_nombre, cliente_datos, precio_acordado_cent, coste_previsto_cent, trabajo,
                              fecha_entrega, fecha_inicio_prevista, notas_internas, instrucciones)
  values (public.siguiente_numero_pedido(extract(year from current_date)::integer), c.id,
          coalesce(nullif(trim(p_datos ->> 'cliente_nombre'), ''), c.nombre),
          case when c.id is null then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object('nombre', c.nombre, 'nif', c.nif, 'email', c.email, 'telefono', c.telefono, 'ciudad', c.ciudad)) end,
          coalesce((p_datos ->> 'precio_acordado_cent')::bigint, 0), nullif(p_datos ->> 'coste_previsto_cent', '')::bigint,
          coalesce(p_datos -> 'trabajo', '{}'::jsonb),
          nullif(p_datos ->> 'fecha_entrega', '')::date, nullif(p_datos ->> 'fecha_inicio_prevista', '')::date,
          nullif(trim(p_datos ->> 'notas_internas'), ''), nullif(trim(p_datos ->> 'instrucciones'), ''))
  returning id into v_id;
  perform public.pedido_guardar_lineas(v_id, coalesce(p_datos -> 'lineas', '[]'::jsonb));
  perform public.pedido_evento(v_id, 'creado', 'Pedido creado sin presupuesto', jsonb_build_object('lineas', jsonb_array_length(coalesce(p_datos -> 'lineas', '[]'::jsonb))));
  return v_id;
end;
$$;

-- Replaces the lines (internal; checked by the callers)
create or replace function public.pedido_guardar_lineas(p_pedido_id bigint, p_lineas jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l jsonb;
  n integer := 0;
begin
  delete from public.pedido_lineas where pedido_id = p_pedido_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    n := n + 1;
    insert into public.pedido_lineas (pedido_id, variante_id, descripcion, cantidad, coste_unitario_previsto, orden)
    values (p_pedido_id, nullif(l ->> 'variante_id', '')::bigint, trim(l ->> 'descripcion'), (l ->> 'cantidad')::integer,
            nullif(l ->> 'coste_unitario_previsto', '')::numeric, n);
  end loop;
end;
$$;

-- Editing the garments is allowed while nothing is reserved or consumed for the order
create or replace function public.pedido_actualizar_lineas(p_pedido_id bigint, p_lineas jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
begin
  p := public.pedido_bloqueado(p_pedido_id);
  if p.estado not in ('pendiente_preparar', 'pendiente_material') then
    raise exception 'Garments can only change before production is ready (state: %)', p.estado using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_reservas where pedido_id = p.id and estado = 'activa')
     or exists (select 1 from public.stock_movimientos where pedido_id = p.id) then
    raise exception 'Release the reservations first: the order already has reserved or used units' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'An order needs at least one line' using errcode = '22023';
  end if;
  perform public.pedido_guardar_lineas(p.id, p_lineas);
  perform public.pedido_actualizar_necesidades(p.id, false);
  perform public.pedido_evento(p.id, 'lineas', 'Prendas del pedido modificadas', jsonb_build_object('lineas', jsonb_array_length(p_lineas)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Order data, state and payment
-- ---------------------------------------------------------------------------
-- p_datos: any of { fecha_entrega, fecha_inicio_prevista, notas_internas, instrucciones } (present keys are set)
create or replace function public.pedido_actualizar(p_pedido_id bigint, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
begin
  p := public.pedido_bloqueado(p_pedido_id, true);
  update public.pedidos set
    fecha_entrega = case when p_datos ? 'fecha_entrega' then nullif(p_datos ->> 'fecha_entrega', '')::date else fecha_entrega end,
    fecha_inicio_prevista = case when p_datos ? 'fecha_inicio_prevista' then nullif(p_datos ->> 'fecha_inicio_prevista', '')::date else fecha_inicio_prevista end,
    notas_internas = case when p_datos ? 'notas_internas' then nullif(trim(p_datos ->> 'notas_internas'), '') else notas_internas end,
    instrucciones = case when p_datos ? 'instrucciones' then nullif(trim(p_datos ->> 'instrucciones'), '') else instrucciones end,
    actualizado_en = now()
  where id = p.id;
  if (p_datos ? 'fecha_entrega' and nullif(p_datos ->> 'fecha_entrega', '')::date is distinct from p.fecha_entrega)
     or (p_datos ? 'fecha_inicio_prevista' and nullif(p_datos ->> 'fecha_inicio_prevista', '')::date is distinct from p.fecha_inicio_prevista) then
    perform public.pedido_evento(p.id, 'fechas', 'Fechas previstas cambiadas',
      jsonb_build_object('antes', jsonb_build_object('entrega', p.fecha_entrega, 'inicio', p.fecha_inicio_prevista),
                         'despues', (select jsonb_build_object('entrega', fecha_entrega, 'inicio', fecha_inicio_prevista) from public.pedidos where id = p.id)));
  end if;
  if p_datos ? 'notas_internas' or p_datos ? 'instrucciones' then
    perform public.pedido_evento(p.id, 'datos', 'Notas o instrucciones actualizadas');
  end if;
end;
$$;

create or replace function public.pedido_cambiar_estado(p_pedido_id bigint, p_estado text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  r record;
begin
  p := public.pedido_bloqueado(p_pedido_id, true);
  if not public.pedido_transicion_permitida(p.estado, p_estado) then
    raise exception 'State change not allowed: % -> %', p.estado, p_estado using errcode = '23514';
  end if;
  if p_estado = 'cancelado' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Cancelling an order needs a reason' using errcode = '22023';
  end if;
  if p_estado = 'cancelado' then
    -- reserved units go back to available; used units stay out (record returns if any)
    for r in select id from public.stock_reservas where pedido_id = p.id and estado = 'activa' order by articulo_id loop
      perform public.stock_liberar_reserva(r.id);
    end loop;
  end if;
  update public.pedidos set estado = p_estado, actualizado_en = now() where id = p.id;
  perform public.pedido_evento(p.id, 'estado', coalesce(nullif(trim(p_motivo), ''), 'Cambio de estado'), jsonb_build_object('desde', p.estado, 'hasta', p_estado));
  perform public.pedido_actualizar_necesidades(p.id, false);
  perform public.pedido_sincronizar_presupuesto(p.id);
end;
$$;

-- Total collected so far: the payment state follows from the agreed price
create or replace function public.pedido_registrar_cobro(p_pedido_id bigint, p_importe_cobrado_cent bigint, p_nota text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  v_estado text;
begin
  p := public.pedido_bloqueado(p_pedido_id, true);
  if p_importe_cobrado_cent is null or p_importe_cobrado_cent < 0 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;
  v_estado := case when p_importe_cobrado_cent = 0 then 'pendiente' when p_importe_cobrado_cent < p.precio_acordado_cent then 'parcial' else 'cobrado' end;
  update public.pedidos set importe_cobrado_cent = p_importe_cobrado_cent, cobro_estado = v_estado, actualizado_en = now() where id = p.id;
  perform public.pedido_evento(p.id, 'cobro', coalesce(nullif(trim(p_nota), ''), 'Cobro actualizado'),
    jsonb_build_object('antes_cent', p.importe_cobrado_cent, 'despues_cent', p_importe_cobrado_cent, 'estado', v_estado));
  perform public.pedido_sincronizar_presupuesto(p.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reservations, consumption, returns
-- ---------------------------------------------------------------------------
/*
 * Reserves the confirmed quantities: p_lineas = [{ variante_id, cantidad }].
 * Each quantity must fit in what the order still needs and in the available
 * stock (items locked in a fixed order, so two orders never take the same
 * units). p_registrar_faltantes: open a purchase need for what is still missing.
 */
create or replace function public.pedido_reservar(p_pedido_id bigint, p_lineas jsonb, p_registrar_faltantes boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  l record;
  q record;
  a public.stock_articulos;
  v_reserva bigint;
  v_total integer := 0;
begin
  p := public.pedido_bloqueado(p_pedido_id);
  for l in
    select (x ->> 'variante_id')::bigint as variante_id, sum((x ->> 'cantidad')::integer)::integer as cantidad
    from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x
    group by 1 order by 1
  loop
    continue when l.cantidad = 0;
    if l.cantidad < 0 then
      raise exception 'Reserve a positive quantity' using errcode = '23514';
    end if;
    select * into q from public.pedido_cantidades(p.id, l.variante_id);
    if q.necesario = 0 then
      raise exception 'Variant % is not in this order', l.variante_id using errcode = '22023';
    end if;
    if l.cantidad > q.necesario - q.reservado - q.usado then
      raise exception 'The order only needs % more units of variant %', greatest(q.necesario - q.reservado - q.usado, 0), l.variante_id using errcode = '23514';
    end if;
    a := public.stock_articulo_bloqueado(l.variante_id, false);
    if a.fisico - a.reservado < l.cantidad then
      raise exception 'Not enough available stock for variant %: % available', l.variante_id, a.fisico - a.reservado using errcode = '23514';
    end if;
    update public.stock_reservas set cantidad = cantidad + l.cantidad
      where articulo_id = a.id and pedido_id = p.id and estado = 'activa'
      returning id into v_reserva;
    if v_reserva is null then
      insert into public.stock_reservas (articulo_id, cantidad, referencia, pedido_id, motivo)
      values (a.id, l.cantidad, p.numero, p.id, 'Reserva del pedido ' || p.numero) returning id into v_reserva;
    end if;
    update public.stock_articulos set reservado = reservado + l.cantidad where id = a.id;
    v_total := v_total + l.cantidad;
    v_reserva := null;
  end loop;
  perform public.pedido_actualizar_necesidades(p.id, p_registrar_faltantes);
  if v_total > 0 then
    perform public.pedido_evento(p.id, 'reserva', v_total || ' unidades reservadas', jsonb_build_object('lineas', p_lineas));
  end if;
  if p_registrar_faltantes then
    perform public.pedido_evento(p.id, 'necesidad', 'Necesidades de compra registradas',
      (select jsonb_build_object('pendientes', coalesce(sum(cantidad), 0)) from public.stock_necesidades where pedido_id = p.id and estado in ('pendiente', 'pedida')));
  end if;
  return jsonb_build_object('reservadas', v_total);
end;
$$;

-- Releases the order's active reservations (all, or one variant)
create or replace function public.pedido_liberar(p_pedido_id bigint, p_variante_id bigint default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  r record;
  v_total integer := 0;
begin
  p := public.pedido_bloqueado(p_pedido_id, true);
  for r in select s.id, s.cantidad from public.stock_reservas s join public.stock_articulos a on a.id = s.articulo_id
           where s.pedido_id = p.id and s.estado = 'activa' and (p_variante_id is null or a.variante_id = p_variante_id) order by s.articulo_id loop
    perform public.stock_liberar_reserva(r.id);
    v_total := v_total + r.cantidad;
  end loop;
  if v_total > 0 then
    perform public.pedido_evento(p.id, 'liberacion', v_total || ' unidades liberadas', jsonb_build_object('variante_id', p_variante_id));
  end if;
  perform public.pedido_actualizar_necesidades(p.id, false);
  return v_total;
end;
$$;

/*
 * Real exit of garments for the order: p_tipo 'salida' (used) or 'merma' (spoiled).
 * Takes the units from the order's reservation first (the consumed part is
 * split off and closed, so they are not discounted twice) and, only if
 * p_desde_disponible, the rest from free stock.
 */
create or replace function public.pedido_consumir(p_pedido_id bigint, p_variante_id bigint, p_cantidad integer, p_tipo text default 'salida',
                                                   p_motivo text default null, p_desde_disponible boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  a public.stock_articulos;
  r public.stock_reservas;
  v_de_reserva integer := 0;
  v_libre integer;
  v_cerrada bigint;
  v_mov bigint;
begin
  p := public.pedido_bloqueado(p_pedido_id);
  if p_tipo not in ('salida', 'merma') then
    raise exception 'Use salida or merma' using errcode = '22023';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Record at least one unit' using errcode = '23514';
  end if;
  if not exists (select 1 from public.pedido_lineas where pedido_id = p.id and variante_id = p_variante_id) then
    raise exception 'Variant % is not in this order', p_variante_id using errcode = '22023';
  end if;
  a := public.stock_articulo_bloqueado(p_variante_id, false);
  select * into r from public.stock_reservas where articulo_id = a.id and pedido_id = p.id and estado = 'activa' for update;
  if found then
    v_de_reserva := least(r.cantidad, p_cantidad);
  end if;
  v_libre := p_cantidad - v_de_reserva;
  if v_libre > 0 and not p_desde_disponible then
    raise exception 'Only % units are reserved for this order', v_de_reserva using errcode = '23514';
  end if;
  if v_libre > a.fisico - a.reservado then
    raise exception 'Not enough available stock: % available', a.fisico - a.reservado using errcode = '23514';
  end if;
  if v_de_reserva > 0 then
    if v_de_reserva = r.cantidad then
      update public.stock_reservas set estado = 'consumida', cerrada_en = now() where id = r.id;
      v_cerrada := r.id;
    else
      update public.stock_reservas set cantidad = cantidad - v_de_reserva where id = r.id;
      insert into public.stock_reservas (articulo_id, cantidad, referencia, pedido_id, estado, motivo, cerrada_en)
      values (a.id, v_de_reserva, p.numero, p.id, 'consumida', 'Parte consumida de la reserva ' || r.id, now()) returning id into v_cerrada;
    end if;
  end if;
  insert into public.stock_movimientos (articulo_id, tipo, cantidad, motivo, referencia, pedido_id, reserva_id)
  values (a.id, p_tipo, -p_cantidad, coalesce(nullif(trim(p_motivo), ''), case when p_tipo = 'merma' then 'Merma en producción' else 'Salida para el pedido' end), p.numero, p.id, v_cerrada)
  returning id into v_mov;
  update public.stock_articulos set fisico = fisico - p_cantidad, reservado = reservado - v_de_reserva where id = a.id;
  perform public.pedido_evento(p.id, case when p_tipo = 'merma' then 'merma' else 'consumo' end,
    p_cantidad || case when p_tipo = 'merma' then ' unidades estropeadas' else ' unidades usadas' end,
    jsonb_build_object('variante_id', p_variante_id, 'cantidad', p_cantidad, 'de_reserva', v_de_reserva, 'movimiento_id', v_mov));
  perform public.pedido_actualizar_necesidades(p.id, false);
  return v_mov;
end;
$$;

-- Unused garments come back to the shelf (at most what went out for this order)
create or replace function public.pedido_devolver(p_pedido_id bigint, p_variante_id bigint, p_cantidad integer, p_motivo text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  a public.stock_articulos;
  q record;
  v_mov bigint;
begin
  p := public.pedido_bloqueado(p_pedido_id, true);
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Return at least one unit' using errcode = '23514';
  end if;
  a := public.stock_articulo_bloqueado(p_variante_id, false);
  select * into q from public.pedido_cantidades(p.id, p_variante_id);
  if p_cantidad > q.usado then
    raise exception 'Only % units went out for this order', q.usado using errcode = '23514';
  end if;
  insert into public.stock_movimientos (articulo_id, tipo, cantidad, motivo, referencia, pedido_id)
  values (a.id, 'devolucion', p_cantidad, coalesce(nullif(trim(p_motivo), ''), 'Devolución del pedido'), p.numero, p.id)
  returning id into v_mov;
  update public.stock_articulos set fisico = fisico + p_cantidad where id = a.id;
  perform public.pedido_evento(p.id, 'devolucion', p_cantidad || ' unidades devueltas al almacén', jsonb_build_object('variante_id', p_variante_id, 'cantidad', p_cantidad, 'movimiento_id', v_mov));
  perform public.pedido_actualizar_necesidades(p.id, false);
  return v_mov;
end;
$$;

-- An open need of the order: 'pendiente' (to buy) or 'pedida' (ordered from the supplier, waiting)
create or replace function public.pedido_necesidad_estado(p_pedido_id bigint, p_variante_id bigint, p_estado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
begin
  p := public.pedido_bloqueado(p_pedido_id, true);
  if p_estado not in ('pendiente', 'pedida') then
    raise exception 'Use pendiente or pedida' using errcode = '22023';
  end if;
  update public.stock_necesidades set estado = p_estado
    where pedido_id = p.id and variante_id = p_variante_id and estado in ('pendiente', 'pedida');
  if not found then
    raise exception 'This order has no open need for that garment' using errcode = 'P0002';
  end if;
  perform public.pedido_evento(p.id, 'necesidad', case when p_estado = 'pedida' then 'Marcado como pedido al proveedor' else 'Marcado como pendiente de comprar' end,
    jsonb_build_object('variante_id', p_variante_id, 'estado', p_estado));
end;
$$;

-- ---------------------------------------------------------------------------
-- Views (security_invoker: owner only through RLS)
-- ---------------------------------------------------------------------------
-- Material of each order per catalogue variant
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
  ), necesidades as (
    select pedido_id, variante_id,
      sum(case when estado = 'pendiente' then cantidad else 0 end)::integer as pendiente_comprar,
      sum(case when estado = 'pedida' then cantidad else 0 end)::integer as pendiente_recibir
    from public.stock_necesidades where pedido_id is not null and estado in ('pendiente', 'pedida') group by 1, 2
  )
  select l.pedido_id, l.variante_id, c.proveedor, c.marca, c.modelo, c.color, c.talla, c.tipo,
    l.necesario,
    coalesce(r.reservado, 0) as reservado,
    coalesce(m.salidas, 0) - coalesce(m.devueltas, 0) as usado,
    coalesce(m.mermas, 0) as merma,
    coalesce(m.devueltas, 0) as devuelto,
    greatest(l.necesario - coalesce(r.reservado, 0) - (coalesce(m.salidas, 0) - coalesce(m.devueltas, 0)), 0) as falta,
    coalesce(s.fisico, 0) as fisico_almacen,
    coalesce(s.fisico - s.reservado, 0) as disponible_almacen,
    coalesce(n.pendiente_comprar, 0) as pendiente_comprar,
    coalesce(n.pendiente_recibir, 0) as pendiente_recibir
  from lineas l
  join public.v_catalogo_admin c on c.variante_id = l.variante_id
  left join reservas r on r.pedido_id = l.pedido_id and r.variante_id = l.variante_id
  left join movimientos m on m.pedido_id = l.pedido_id and m.variante_id = l.variante_id
  left join necesidades n on n.pedido_id = l.pedido_id and n.variante_id = l.variante_id
  left join public.stock_articulos s on s.variante_id = l.variante_id;

-- Orders with a material summary (for the list and "needs attention")
create or replace view public.v_pedidos with (security_invoker = true) as
  select p.id, p.numero, p.presupuesto_id, q.numero as presupuesto_numero, p.cliente_id, p.cliente_nombre, p.estado, p.cobro_estado,
    p.importe_cobrado_cent, p.precio_acordado_cent, p.coste_previsto_cent, p.fecha_entrega, p.fecha_inicio_prevista, p.creado_en, p.actualizado_en,
    coalesce(sum(m.necesario), 0)::integer as unidades,
    coalesce(sum(m.reservado + m.usado), 0)::integer as unidades_cubiertas,
    coalesce(sum(m.falta), 0)::integer as unidades_faltan,
    coalesce(sum(m.pendiente_comprar), 0)::integer as pendiente_comprar,
    coalesce(sum(m.pendiente_recibir), 0)::integer as pendiente_recibir,
    (select count(*) from public.pedido_lineas l where l.pedido_id = p.id and l.variante_id is null)::integer as lineas_sin_catalogo
  from public.pedidos p
  left join public.presupuestos q on q.id = p.presupuesto_id
  left join public.v_pedidos_material m on m.pedido_id = p.id
  group by p.id, q.numero;

-- Open purchase needs of orders, by supplier and variant
create or replace view public.v_necesidades_pedidos with (security_invoker = true) as
  select n.id, n.pedido_id, p.numero, p.cliente_nombre, p.fecha_entrega, n.variante_id, c.proveedor, c.marca, c.modelo, c.color, c.talla,
    n.cantidad, n.estado, n.creado_en
  from public.stock_necesidades n
  join public.pedidos p on p.id = n.pedido_id
  join public.v_catalogo_admin c on c.variante_id = n.variante_id
  where n.estado in ('pendiente', 'pedida');

-- Purchase suggestions: needs already ordered from the supplier are shown apart, not suggested again
drop view if exists public.v_stock_compras;
create view public.v_stock_compras with (security_invoker = true) as
  with necesidades as (
    select variante_id,
      sum(case when estado = 'pendiente' then cantidad else 0 end) as pendiente,
      sum(case when estado = 'pedida' then cantidad else 0 end) as pedida
    from public.stock_necesidades where estado in ('pendiente', 'pedida') group by variante_id
  ),
  base as (
    select c.variante_id, c.proveedor, c.propio, c.tipo, c.modelo, c.color, c.talla, c.coste as coste_catalogo,
      coalesce(s.fisico - s.reservado, 0) as disponible, coalesce(s.stock_minimo, 0) as stock_minimo,
      coalesce(n.pendiente, 0) as necesidades, coalesce(n.pedida, 0) as pendiente_recibir
    from public.v_catalogo_admin c
    left join public.stock_articulos s on s.variante_id = c.variante_id
    left join necesidades n on n.variante_id = c.variante_id
    where (s.id is not null and s.activo) or n.variante_id is not null
  )
  select *, greatest(stock_minimo + necesidades - disponible, 0) as sugerido
  from base
  where stock_minimo + necesidades - disponible > 0 or pendiente_recibir > 0;

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------
alter table public.pedidos enable row level security;
alter table public.pedido_lineas enable row level security;
alter table public.pedido_eventos enable row level security;
drop policy if exists pedidos_lectura on public.pedidos;
drop policy if exists pedido_lineas_lectura on public.pedido_lineas;
drop policy if exists pedido_eventos_lectura on public.pedido_eventos;
create policy pedidos_lectura on public.pedidos for select to authenticated using (public.es_propietario());
create policy pedido_lineas_lectura on public.pedido_lineas for select to authenticated using (public.es_propietario());
create policy pedido_eventos_lectura on public.pedido_eventos for select to authenticated using (public.es_propietario());

-- Read only for the app: every change goes through the functions (which check the owner)
revoke all on public.pedidos, public.pedido_lineas, public.pedido_eventos from anon, authenticated;
grant select on public.pedidos, public.pedido_lineas, public.pedido_eventos to authenticated;
grant select on public.pedidos, public.pedido_lineas, public.pedido_eventos to service_role;
revoke all on public.v_pedidos_material, public.v_pedidos, public.v_necesidades_pedidos, public.v_stock_compras from anon;
grant select on public.v_pedidos_material, public.v_pedidos, public.v_necesidades_pedidos, public.v_stock_compras to authenticated;
grant select on public.v_pedidos_material, public.v_pedidos, public.v_necesidades_pedidos, public.v_stock_compras to service_role;

-- Internal helpers: not callable from the API
revoke execute on function public.siguiente_numero_pedido(integer) from anon, authenticated, public;
revoke execute on function public.pedido_evento(bigint, text, text, jsonb) from anon, authenticated, public;
revoke execute on function public.pedido_bloqueado(bigint, boolean) from anon, authenticated, public;
revoke execute on function public.pedido_cantidades(bigint, bigint) from anon, authenticated, public;
revoke execute on function public.pedido_actualizar_necesidades(bigint, boolean) from anon, authenticated, public;
revoke execute on function public.pedido_sincronizar_presupuesto(bigint) from anon, authenticated, public;
revoke execute on function public.pedido_guardar_lineas(bigint, jsonb) from anon, authenticated, public;

-- Operations for the owner (each one checks es_propietario)
revoke execute on function public.crear_pedido_desde_presupuesto(bigint, jsonb) from anon, public;
revoke execute on function public.crear_pedido(jsonb) from anon, public;
revoke execute on function public.pedido_actualizar_lineas(bigint, jsonb) from anon, public;
revoke execute on function public.pedido_actualizar(bigint, jsonb) from anon, public;
revoke execute on function public.pedido_cambiar_estado(bigint, text, text) from anon, public;
revoke execute on function public.pedido_registrar_cobro(bigint, bigint, text) from anon, public;
revoke execute on function public.pedido_reservar(bigint, jsonb, boolean) from anon, public;
revoke execute on function public.pedido_liberar(bigint, bigint) from anon, public;
revoke execute on function public.pedido_consumir(bigint, bigint, integer, text, text, boolean) from anon, public;
revoke execute on function public.pedido_devolver(bigint, bigint, integer, text) from anon, public;
revoke execute on function public.pedido_necesidad_estado(bigint, bigint, text) from anon, public;
grant execute on function public.crear_pedido_desde_presupuesto(bigint, jsonb) to authenticated;
grant execute on function public.crear_pedido(jsonb) to authenticated;
grant execute on function public.pedido_actualizar_lineas(bigint, jsonb) to authenticated;
grant execute on function public.pedido_actualizar(bigint, jsonb) to authenticated;
grant execute on function public.pedido_cambiar_estado(bigint, text, text) to authenticated;
grant execute on function public.pedido_registrar_cobro(bigint, bigint, text) to authenticated;
grant execute on function public.pedido_reservar(bigint, jsonb, boolean) to authenticated;
grant execute on function public.pedido_liberar(bigint, bigint) to authenticated;
grant execute on function public.pedido_consumir(bigint, bigint, integer, text, text, boolean) to authenticated;
grant execute on function public.pedido_devolver(bigint, bigint, integer, text) to authenticated;
grant execute on function public.pedido_necesidad_estado(bigint, bigint, text) to authenticated;
grant execute on function public.pedido_transicion_permitida(text, text) to authenticated;
revoke execute on function public.pedido_transicion_permitida(text, text) from anon, public;
