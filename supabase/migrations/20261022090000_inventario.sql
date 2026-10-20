-- Workshop inventory: physical stock, reservations and an auditable movement
-- log. Separate from the catalogue (what can be bought): an item is stocked
-- only when there are movements for it.
--
-- * Each stock item is one catalogue variant (supplier product or own product),
--   so model, colour and size are always unambiguous.
-- * Quantities change ONLY through the functions below, which lock the item row
--   (SELECT ... FOR UPDATE) so concurrent operations cannot use the same units,
--   and validate every rule in one transaction. Constraints are a second line
--   of defence: physical >= reserved >= 0.
-- * Movements are never updated or deleted: a mistake is undone by a
--   compensating "correccion" movement linked to the original.
-- * Each entry keeps its own acquisition cost; catalogue price changes never
--   alter past entries. Quotes never touch stock.
--
-- Safety: only new tables, views and functions. Existing data is not touched.

create table if not exists public.stock_articulos (
  id bigint generated always as identity primary key,
  variante_id bigint not null unique references public.variantes on delete restrict,
  fisico integer not null default 0 check (fisico >= 0),
  reservado integer not null default 0 check (reservado >= 0),
  stock_minimo integer not null default 0 check (stock_minimo >= 0),
  ubicacion text,
  notas text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint stock_reservado_hasta_fisico check (reservado <= fisico)
);

create table if not exists public.stock_movimientos (
  id bigint generated always as identity primary key,
  articulo_id bigint not null references public.stock_articulos on delete restrict,
  tipo text not null check (tipo in ('inicial', 'entrada', 'salida', 'devolucion', 'merma', 'ajuste', 'correccion')),
  cantidad integer not null check (cantidad <> 0), -- signed change of physical stock
  fecha date not null default current_date,
  motivo text,
  referencia text, -- order, purchase or delivery note, if any
  coste_unitario numeric(14, 6) check (coste_unitario is null or coste_unitario >= 0),
  corrige_movimiento_id bigint unique references public.stock_movimientos on delete restrict,
  creado_en timestamptz not null default now(),
  constraint stock_signo_por_tipo check (
    (tipo in ('inicial', 'entrada', 'devolucion') and cantidad > 0)
    or (tipo in ('salida', 'merma') and cantidad < 0)
    or tipo in ('ajuste', 'correccion')
  ),
  constraint stock_correccion_enlazada check ((tipo = 'correccion') = (corrige_movimiento_id is not null))
);
create index if not exists stock_movimientos_articulo_idx on public.stock_movimientos (articulo_id, creado_en desc);
-- Opening stock is recorded once per item
create unique index if not exists stock_inicial_unico on public.stock_movimientos (articulo_id) where tipo = 'inicial';

create table if not exists public.stock_reservas (
  id bigint generated always as identity primary key,
  articulo_id bigint not null references public.stock_articulos on delete restrict,
  cantidad integer not null check (cantidad > 0),
  referencia text not null check (length(trim(referencia)) > 0), -- e.g. the order number
  pedido_id bigint, -- link to the future orders module
  estado text not null default 'activa' check (estado in ('activa', 'liberada', 'consumida')),
  motivo text,
  creado_en timestamptz not null default now(),
  cerrada_en timestamptz
);
-- One active reservation per item and order reference
create unique index if not exists stock_reserva_activa_unica on public.stock_reservas (articulo_id, lower(referencia)) where estado = 'activa';

-- Registered needs (future orders not yet covered), for purchase suggestions
create table if not exists public.stock_necesidades (
  id bigint generated always as identity primary key,
  variante_id bigint not null references public.variantes on delete restrict,
  cantidad integer not null check (cantidad > 0),
  referencia text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'atendida', 'cancelada')),
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Operations (SECURITY DEFINER: quantities are not writable directly; every
-- function checks the owner first)
-- ---------------------------------------------------------------------------
create or replace function public.stock_articulo_bloqueado(p_variante_id bigint, p_crear boolean)
returns public.stock_articulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.stock_articulos;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into a from public.stock_articulos where variante_id = p_variante_id for update;
  if not found then
    if not p_crear then
      raise exception 'This item has no stock' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.variantes where id = p_variante_id) then
      raise exception 'Unknown catalogue variant' using errcode = '23503';
    end if;
    insert into public.stock_articulos (variante_id) values (p_variante_id)
    on conflict (variante_id) do nothing;
    select * into a from public.stock_articulos where variante_id = p_variante_id for update;
  end if;
  return a;
end;
$$;

-- Records one movement and applies it to the physical stock
create or replace function public.stock_registrar(
  p_variante_id bigint, p_tipo text, p_cantidad integer, p_motivo text default null,
  p_referencia text default null, p_coste_unitario numeric default null, p_fecha date default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.stock_articulos;
  v_id bigint;
begin
  if p_tipo not in ('entrada', 'salida', 'devolucion', 'merma', 'ajuste') then
    raise exception 'Use stock_carga_inicial for opening stock and stock_corregir for corrections' using errcode = '22023';
  end if;
  if p_tipo = 'ajuste' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'An adjustment needs a reason' using errcode = '22023';
  end if;
  a := public.stock_articulo_bloqueado(p_variante_id, p_cantidad > 0);
  if a.fisico + p_cantidad < a.reservado then
    raise exception 'Not enough stock: % physical, % reserved, change %', a.fisico, a.reservado, p_cantidad using errcode = '23514';
  end if;
  insert into public.stock_movimientos (articulo_id, tipo, cantidad, fecha, motivo, referencia, coste_unitario)
  values (a.id, p_tipo, p_cantidad, coalesce(p_fecha, current_date), nullif(trim(p_motivo), ''), nullif(trim(p_referencia), ''),
          case when p_cantidad > 0 then p_coste_unitario end)
  returning id into v_id;
  update public.stock_articulos set fisico = fisico + p_cantidad where id = a.id;
  return v_id;
end;
$$;

-- Opening stock for several items in one transaction:
-- p_lineas = [{ variante_id, cantidad, coste_unitario? }]
create or replace function public.stock_carga_inicial(p_lineas jsonb, p_motivo text default null, p_fecha date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  a public.stock_articulos;
  n integer := 0;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Nothing to record' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_lineas) loop
    if (r ->> 'cantidad')::integer <= 0 then
      raise exception 'Opening quantities must be positive' using errcode = '23514';
    end if;
    a := public.stock_articulo_bloqueado((r ->> 'variante_id')::bigint, true);
    if exists (select 1 from public.stock_movimientos where articulo_id = a.id) then
      raise exception 'Item % already has stock movements: use an entry or an adjustment', (r ->> 'variante_id') using errcode = '23505';
    end if;
    insert into public.stock_movimientos (articulo_id, tipo, cantidad, fecha, motivo, coste_unitario)
    values (a.id, 'inicial', (r ->> 'cantidad')::integer, coalesce(p_fecha, current_date), coalesce(nullif(trim(p_motivo), ''), 'Inventario inicial'),
            (r ->> 'coste_unitario')::numeric);
    update public.stock_articulos set fisico = fisico + (r ->> 'cantidad')::integer where id = a.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Undoes a movement with a compensating one (the original stays in the log)
create or replace function public.stock_corregir(p_movimiento_id bigint, p_motivo text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.stock_movimientos;
  a public.stock_articulos;
  v_id bigint;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'A correction needs a reason' using errcode = '22023';
  end if;
  select * into m from public.stock_movimientos where id = p_movimiento_id;
  if not found then
    raise exception 'Movement not found' using errcode = 'P0002';
  end if;
  if m.tipo = 'correccion' then
    raise exception 'A correction cannot be corrected: record a new movement instead' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_movimientos where corrige_movimiento_id = m.id) then
    raise exception 'This movement has already been corrected' using errcode = '23505';
  end if;
  select * into a from public.stock_articulos where id = m.articulo_id for update;
  if a.fisico - m.cantidad < a.reservado then
    raise exception 'Correcting it would leave less stock than reserved' using errcode = '23514';
  end if;
  insert into public.stock_movimientos (articulo_id, tipo, cantidad, motivo, referencia, corrige_movimiento_id)
  values (a.id, 'correccion', -m.cantidad, trim(p_motivo), m.referencia, m.id)
  returning id into v_id;
  update public.stock_articulos set fisico = fisico - m.cantidad where id = a.id;
  return v_id;
end;
$$;

-- Reservations: reduce available units, not physical ones
create or replace function public.stock_reservar(p_variante_id bigint, p_cantidad integer, p_referencia text, p_pedido_id bigint default null, p_motivo text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.stock_articulos;
  v_id bigint;
begin
  if p_cantidad <= 0 then
    raise exception 'Reserve at least one unit' using errcode = '23514';
  end if;
  a := public.stock_articulo_bloqueado(p_variante_id, false);
  if a.fisico - a.reservado < p_cantidad then
    raise exception 'Not enough available stock: % available', a.fisico - a.reservado using errcode = '23514';
  end if;
  insert into public.stock_reservas (articulo_id, cantidad, referencia, pedido_id, motivo)
  values (a.id, p_cantidad, trim(p_referencia), p_pedido_id, nullif(trim(p_motivo), ''))
  returning id into v_id;
  update public.stock_articulos set reservado = reservado + p_cantidad where id = a.id;
  return v_id;
end;
$$;

create or replace function public.stock_liberar_reserva(p_reserva_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.stock_reservas;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into r from public.stock_reservas where id = p_reserva_id for update;
  if not found or r.estado <> 'activa' then
    raise exception 'Only an active reservation can be released' using errcode = '22023';
  end if;
  perform 1 from public.stock_articulos where id = r.articulo_id for update;
  update public.stock_reservas set estado = 'liberada', cerrada_en = now() where id = r.id;
  update public.stock_articulos set reservado = reservado - r.cantidad where id = r.articulo_id;
end;
$$;

-- For the future orders module: the reserved units leave the workshop
create or replace function public.stock_consumir_reserva(p_reserva_id bigint, p_motivo text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.stock_reservas;
  v_id bigint;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into r from public.stock_reservas where id = p_reserva_id for update;
  if not found or r.estado <> 'activa' then
    raise exception 'Only an active reservation can be consumed' using errcode = '22023';
  end if;
  perform 1 from public.stock_articulos where id = r.articulo_id for update;
  update public.stock_reservas set estado = 'consumida', cerrada_en = now() where id = r.id;
  update public.stock_articulos set reservado = reservado - r.cantidad, fisico = fisico - r.cantidad where id = r.articulo_id;
  insert into public.stock_movimientos (articulo_id, tipo, cantidad, motivo, referencia)
  values (r.articulo_id, 'salida', -r.cantidad, coalesce(nullif(trim(p_motivo), ''), 'Salida de una reserva'), r.referencia)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
-- Weighted average acquisition cost of the units that came in (corrected
-- entries excluded). A valuation PROPOSAL: not used by quotes.
create or replace view public.v_stock with (security_invoker = true) as
  with costes as (
    select m.articulo_id,
      sum(m.cantidad * m.coste_unitario) / nullif(sum(m.cantidad), 0) as coste_medio
    from public.stock_movimientos m
    where m.cantidad > 0 and m.coste_unitario is not null and m.tipo in ('inicial', 'entrada', 'devolucion')
      and not exists (select 1 from public.stock_movimientos c where c.corrige_movimiento_id = m.id)
    group by m.articulo_id
  )
  select s.id as articulo_id, s.variante_id, c.proveedor, c.propio, c.tipo, c.modelo, c.modelo_id, c.color, c.talla,
    c.coste as coste_catalogo, c.disponible as en_catalogo,
    s.fisico, s.reservado, s.fisico - s.reservado as disponible, s.stock_minimo,
    (s.fisico - s.reservado) < s.stock_minimo as bajo_minimo,
    k.coste_medio, s.fisico * k.coste_medio as valor,
    s.ubicacion, s.notas, s.activo
  from public.stock_articulos s
  join public.v_catalogo_admin c on c.variante_id = s.variante_id
  left join costes k on k.articulo_id = s.id;

-- Purchase suggestions (a recommendation, not a purchase)
create or replace view public.v_stock_compras with (security_invoker = true) as
  with necesidades as (
    select variante_id, sum(cantidad) as pendiente from public.stock_necesidades where estado = 'pendiente' group by variante_id
  ),
  base as (
    select c.variante_id, c.proveedor, c.propio, c.tipo, c.modelo, c.color, c.talla, c.coste as coste_catalogo,
      coalesce(s.fisico - s.reservado, 0) as disponible, coalesce(s.stock_minimo, 0) as stock_minimo,
      coalesce(n.pendiente, 0) as necesidades
    from public.v_catalogo_admin c
    left join public.stock_articulos s on s.variante_id = c.variante_id
    left join necesidades n on n.variante_id = c.variante_id
    where (s.id is not null and s.activo) or n.pendiente is not null
  )
  select *, greatest(stock_minimo + necesidades - disponible, 0) as sugerido
  from base
  where stock_minimo + necesidades - disponible > 0;

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------
alter table public.stock_articulos enable row level security;
alter table public.stock_movimientos enable row level security;
alter table public.stock_reservas enable row level security;
alter table public.stock_necesidades enable row level security;

drop policy if exists stock_articulos_lectura on public.stock_articulos;
drop policy if exists stock_articulos_cambio on public.stock_articulos;
drop policy if exists stock_movimientos_lectura on public.stock_movimientos;
drop policy if exists stock_reservas_lectura on public.stock_reservas;
drop policy if exists stock_necesidades_propietario on public.stock_necesidades;
create policy stock_articulos_lectura on public.stock_articulos for select to authenticated using (public.es_propietario());
create policy stock_articulos_cambio on public.stock_articulos for update to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy stock_movimientos_lectura on public.stock_movimientos for select to authenticated using (public.es_propietario());
create policy stock_reservas_lectura on public.stock_reservas for select to authenticated using (public.es_propietario());
create policy stock_necesidades_propietario on public.stock_necesidades for all to authenticated using (public.es_propietario()) with check (public.es_propietario());

-- Quantities, movements and reservations are written only by the functions
revoke all on public.stock_articulos, public.stock_movimientos, public.stock_reservas, public.stock_necesidades from anon, authenticated;
grant select on public.stock_articulos, public.stock_movimientos, public.stock_reservas to authenticated;
grant update (stock_minimo, ubicacion, notas, activo) on public.stock_articulos to authenticated;
grant select, insert, update on public.stock_necesidades to authenticated;
grant select on public.v_stock, public.v_stock_compras to authenticated;
grant select on public.stock_articulos, public.stock_movimientos, public.stock_reservas, public.stock_necesidades, public.v_stock, public.v_stock_compras to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.v_stock, public.v_stock_compras from anon;

revoke execute on function public.stock_articulo_bloqueado(bigint, boolean) from anon, public, authenticated;
revoke execute on function public.stock_registrar(bigint, text, integer, text, text, numeric, date) from anon, public;
revoke execute on function public.stock_carga_inicial(jsonb, text, date) from anon, public;
revoke execute on function public.stock_corregir(bigint, text) from anon, public;
revoke execute on function public.stock_reservar(bigint, integer, text, bigint, text) from anon, public;
revoke execute on function public.stock_liberar_reserva(bigint) from anon, public;
revoke execute on function public.stock_consumir_reserva(bigint, text) from anon, public;
grant execute on function public.stock_registrar(bigint, text, integer, text, text, numeric, date) to authenticated;
grant execute on function public.stock_carga_inicial(jsonb, text, date) to authenticated;
grant execute on function public.stock_corregir(bigint, text) to authenticated;
grant execute on function public.stock_reservar(bigint, integer, text, bigint, text) to authenticated;
grant execute on function public.stock_liberar_reserva(bigint) to authenticated;
grant execute on function public.stock_consumir_reserva(bigint, text) to authenticated;
