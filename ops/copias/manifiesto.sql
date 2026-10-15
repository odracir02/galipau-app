-- Prints a JSON manifest of the public schema: row count and a checksum of
-- every table. Computed on the source database and again on the restored copy;
-- both must match for a backup to be accepted.
-- Run with: psql -qtAX -v ON_ERROR_STOP=1 -f manifiesto.sql
-- Output formatting is pinned so both sides render rows identically.

set timezone = 'UTC';
set datestyle = 'ISO, YMD';
set intervalstyle = 'postgres';
set bytea_output = 'hex';
set extra_float_digits = 1;

create or replace function pg_temp.galipau_manifiesto()
returns jsonb
language plpgsql
as $$
declare
  t record;
  filas bigint;
  huella text;
  resultado jsonb := '{}'::jsonb;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    -- COLLATE "C": ordering independent of the server's locale
    execute format(
      'select count(*), md5(coalesce(string_agg(x::text, %L order by x::text collate "C"), %L)) from public.%I x',
      E'\n', '', t.relname
    ) into filas, huella;
    resultado := resultado || jsonb_build_object(t.relname, jsonb_build_object('filas', filas, 'md5', huella));
  end loop;
  return resultado;
end;
$$;

select pg_temp.galipau_manifiesto();
