-- Galipau App: initial PostgreSQL schema for Supabase (PostgreSQL 15+).
-- Single owner: every table is protected by Row Level Security and only the
-- user registered in public.propietario can read or write.
-- Money is stored as integer cents.

-- ---------------------------------------------------------------------------
-- Owner
-- ---------------------------------------------------------------------------
-- No foreign key to auth.users on purpose: backups of the public schema then
-- contain no authentication data, and restores do not depend on auth.
create table public.propietario (
  id smallint primary key default 1 check (id = 1),
  user_id uuid not null unique,
  creado_en timestamptz not null default now()
);

create function public.es_propietario()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.propietario where user_id = auth.uid());
$$;

-- Keeps actualizado_en current on every update
create function public.marcar_actualizado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings and document numbering
-- ---------------------------------------------------------------------------
create table public.configuracion (
  clave text primary key check (length(trim(clave)) > 0),
  valor jsonb not null,
  actualizado_en timestamptz not null default now()
);

create table public.contadores (
  serie text not null check (serie ~ '^[A-Z]{1,5}$'),
  anio integer not null check (anio between 2000 and 2999),
  ultimo integer not null check (ultimo >= 0),
  primary key (serie, anio)
);

-- Gap-free sequential numbers (e.g. P-2026-0001). Runs with the caller's
-- rights, so RLS on contadores restricts it to the owner. Call it inside the
-- same transaction (or RPC) that creates the document.
create function public.siguiente_numero(p_serie text, p_anio integer default null)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_anio integer := coalesce(p_anio, extract(year from current_date)::integer);
  v_ultimo integer;
begin
  insert into public.contadores (serie, anio, ultimo) values (p_serie, v_anio, 1)
  on conflict (serie, anio) do update set ultimo = public.contadores.ultimo + 1
  returning ultimo into v_ultimo;
  return p_serie || '-' || v_anio || '-' || lpad(v_ultimo::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.clientes (
  id bigint generated always as identity primary key,
  tipo text not null default 'particular' check (tipo in ('empresa', 'particular', 'asociacion')),
  nombre text not null check (length(trim(nombre)) > 0),
  razon_social text,
  nif text unique check (nif is null or nif ~ '^[A-Z0-9]{5,20}$'),
  email text check (email is null or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  telefono text,
  direccion text,
  codigo_postal text,
  ciudad text,
  provincia text,
  pais text not null default 'España',
  notas text,
  archivado boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index clientes_nombre_idx on public.clientes (lower(nombre));

-- ---------------------------------------------------------------------------
-- Catalogue: suppliers -> models -> variants
-- ---------------------------------------------------------------------------
create table public.proveedores (
  id bigint generated always as identity primary key,
  nombre text not null unique check (length(trim(nombre)) > 0),
  nif text,
  email text,
  telefono text,
  web text,
  notas text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.modelos (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references public.proveedores on delete restrict,
  tipo text not null check (length(trim(tipo)) > 0),
  nombre text not null check (length(trim(nombre)) > 0),
  referencia text,
  descripcion text,
  activo boolean not null default true,
  unique (proveedor_id, tipo, nombre)
);
create index modelos_proveedor_idx on public.modelos (proveedor_id);

create table public.variantes (
  id bigint generated always as identity primary key,
  modelo_id bigint not null references public.modelos on delete restrict,
  color text not null check (length(trim(color)) > 0),
  talla text not null check (length(trim(talla)) > 0),
  coste_cent integer not null check (coste_cent >= 0),
  activo boolean not null default true,
  unique (modelo_id, color, talla)
);
create index variantes_modelo_idx on public.variantes (modelo_id);

-- Flat catalogue in the shape used by the quote form. security_invoker makes
-- the view respect the RLS policies of the underlying tables.
create view public.v_catalogo_plano with (security_invoker = true) as
  select v.id, m.tipo, p.nombre as proveedor, m.nombre as modelo, v.talla, v.color, v.coste_cent
  from public.variantes v
  join public.modelos m on m.id = v.modelo_id
  join public.proveedores p on p.id = m.proveedor_id
  where v.activo and m.activo and p.activo;

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------
create table public.presupuestos (
  id bigint generated always as identity primary key,
  numero text not null unique,
  version integer not null default 1 check (version >= 1),
  cliente_id bigint references public.clientes on delete restrict,
  cliente_nombre text not null,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviado', 'aceptado', 'rechazado', 'caducado', 'convertido', 'importado')),
  fecha_emision date not null default current_date,
  valido_hasta date check (valido_hasta is null or valido_hasta >= fecha_emision),
  motor text not null,
  entrada jsonb not null,
  resultado jsonb,
  total_cent bigint not null check (total_cent >= 0),
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index presupuestos_cliente_idx on public.presupuestos (cliente_id);
create index presupuestos_fecha_idx on public.presupuestos (fecha_emision desc);

-- ---------------------------------------------------------------------------
-- Backup log (written by the backup workflow, read by the app)
-- ---------------------------------------------------------------------------
create table public.registro_copias (
  id bigint generated always as identity primary key,
  creada_en timestamptz not null default now(),
  tipo text not null check (tipo in ('base_datos', 'archivos')),
  estado text not null check (estado in ('correcta', 'fallida')),
  tamano_bytes bigint check (tamano_bytes is null or tamano_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  detalle jsonb not null default '{}'::jsonb
);
create index registro_copias_fecha_idx on public.registro_copias (creada_en desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger configuracion_actualizado before update on public.configuracion
  for each row execute function public.marcar_actualizado();
create trigger clientes_actualizado before update on public.clientes
  for each row execute function public.marcar_actualizado();
create trigger proveedores_actualizado before update on public.proveedores
  for each row execute function public.marcar_actualizado();
create trigger presupuestos_actualizado before update on public.presupuestos
  for each row execute function public.marcar_actualizado();

-- ---------------------------------------------------------------------------
-- Row Level Security: owner only
-- ---------------------------------------------------------------------------
alter table public.propietario enable row level security;
alter table public.configuracion enable row level security;
alter table public.contadores enable row level security;
alter table public.clientes enable row level security;
alter table public.proveedores enable row level security;
alter table public.modelos enable row level security;
alter table public.variantes enable row level security;
alter table public.presupuestos enable row level security;
alter table public.registro_copias enable row level security;

-- The owner row is created by the project owner from the SQL editor; the app
-- can only check its own row.
create policy propietario_lectura on public.propietario
  for select to authenticated using (user_id = auth.uid());

create policy configuracion_propietario on public.configuracion
  for all to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy contadores_propietario on public.contadores
  for all to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy clientes_propietario on public.clientes
  for all to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy proveedores_propietario on public.proveedores
  for all to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy modelos_propietario on public.modelos
  for all to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy variantes_propietario on public.variantes
  for all to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy presupuestos_propietario on public.presupuestos
  for all to authenticated using (public.es_propietario()) with check (public.es_propietario());
-- Backup log: read-only for the owner (rows are inserted by the backup job)
create policy registro_copias_lectura on public.registro_copias
  for select to authenticated using (public.es_propietario());

-- ---------------------------------------------------------------------------
-- Privileges. Granted explicitly, so the schema works whether or not the
-- project exposes new tables to the Data API automatically. Row Level
-- Security above still restricts every row to the owner.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on
  public.configuracion, public.contadores, public.clientes, public.proveedores,
  public.modelos, public.variantes, public.presupuestos
  to authenticated;
grant select on public.propietario, public.registro_copias, public.v_catalogo_plano to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- service_role (secret key) is only used by the backup jobs
grant select on all tables in schema public to service_role;
grant insert on public.registro_copias to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Nothing for anonymous visitors (defence in depth on top of RLS)
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.es_propietario() to authenticated;
grant execute on function public.siguiente_numero(text, integer) to authenticated;
revoke insert, update, delete on public.propietario from authenticated;
revoke insert, update, delete on public.registro_copias from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
