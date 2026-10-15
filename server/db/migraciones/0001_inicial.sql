-- Initial schema: configuration, owner authentication, customers, catalogue,
-- quotes and backup log. Money is always stored as integer cents.
-- Dates are ISO 8601 text; date checks use IS so that NULL (invalid date) fails.

create table configuracion (
  clave text primary key,
  valor text not null check (json_valid(valor))
) strict;

-- Single owner: at most one row
create table propietario (
  id integer primary key check (id = 1),
  hash_contrasena text not null,
  actualizado_en text not null
) strict;

create table sesiones (
  token_hash text primary key,
  creada_en text not null,
  caduca_en text not null,
  ultimo_uso text not null
) strict;

create table contadores (
  serie text not null,
  anio integer not null check (anio between 2000 and 2999),
  ultimo integer not null check (ultimo >= 0),
  primary key (serie, anio)
) strict;

create table clientes (
  id integer primary key,
  tipo text not null default 'particular' check (tipo in ('empresa', 'particular', 'asociacion')),
  nombre text not null check (length(trim(nombre)) > 0),
  razon_social text,
  nif text unique,
  email text,
  telefono text,
  direccion text,
  codigo_postal text,
  ciudad text,
  provincia text,
  pais text not null default 'España',
  notas text,
  archivado integer not null default 0 check (archivado in (0, 1)),
  creado_en text not null,
  actualizado_en text not null
) strict;

create table proveedores (
  id integer primary key,
  nombre text not null unique check (length(trim(nombre)) > 0),
  nif text,
  email text,
  telefono text,
  web text,
  notas text,
  activo integer not null default 1 check (activo in (0, 1)),
  creado_en text not null,
  actualizado_en text not null
) strict;

create table modelos (
  id integer primary key,
  proveedor_id integer not null references proveedores on delete restrict,
  tipo text not null check (length(trim(tipo)) > 0),
  nombre text not null check (length(trim(nombre)) > 0),
  referencia text,
  descripcion text,
  activo integer not null default 1 check (activo in (0, 1)),
  unique (proveedor_id, tipo, nombre)
) strict;

create table variantes (
  id integer primary key,
  modelo_id integer not null references modelos on delete restrict,
  color text not null check (length(trim(color)) > 0),
  talla text not null check (length(trim(talla)) > 0),
  coste_cent integer not null check (coste_cent >= 0),
  activo integer not null default 1 check (activo in (0, 1)),
  unique (modelo_id, color, talla)
) strict;
create index idx_variantes_modelo on variantes (modelo_id);

create table presupuestos (
  id integer primary key,
  numero text not null unique,
  version integer not null default 1 check (version >= 1),
  cliente_id integer references clientes on delete restrict,
  cliente_nombre text not null,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviado', 'aceptado', 'rechazado', 'caducado', 'convertido', 'importado')),
  fecha_emision text not null check (date(fecha_emision) is fecha_emision),
  valido_hasta text check (valido_hasta is null or date(valido_hasta) is valido_hasta),
  motor text not null,
  entrada_json text not null check (json_valid(entrada_json)),
  resultado_json text check (resultado_json is null or json_valid(resultado_json)),
  total_cent integer not null check (total_cent >= 0),
  notas text,
  creado_en text not null,
  actualizado_en text not null
) strict;
create index idx_presupuestos_cliente on presupuestos (cliente_id);

create table registro_copias (
  id integer primary key,
  archivo text not null,
  motivo text not null check (motivo in ('automatica', 'manual', 'migracion', 'restauracion')),
  creada_en text not null,
  tamano_bytes integer,
  version_esquema integer,
  integridad_ok integer not null check (integridad_ok in (0, 1)),
  copia_externa text,
  error text
) strict;
