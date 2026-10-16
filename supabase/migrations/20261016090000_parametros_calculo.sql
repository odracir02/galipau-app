-- Versioned pricing parameters per printing technique.
-- A version is never edited: changing any value creates a new version and
-- archives the previous one, so every quote can record which version it used.
-- Exactly one active version per technique. Owner only (RLS).

create table public.parametros_calculo (
  id bigint generated always as identity primary key,
  tecnica text not null check (tecnica in ('serigrafia', 'dtf')),
  version integer not null check (version >= 1),
  estado text not null check (estado in ('activa', 'archivada')),
  valores jsonb not null check (jsonb_typeof(valores) = 'object'),
  notas text,
  creado_en timestamptz not null default now(),
  unique (tecnica, version)
);
create unique index parametros_calculo_una_activa on public.parametros_calculo (tecnica) where estado = 'activa';

-- Only the state may change, and only from active to archived
create function public.proteger_parametros_calculo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tecnica is distinct from old.tecnica or new.version is distinct from old.version
     or new.valores is distinct from old.valores or new.notas is distinct from old.notas
     or new.creado_en is distinct from old.creado_en then
    raise exception 'Parameter versions are immutable: create a new version instead' using errcode = '42501';
  end if;
  if old.estado = 'archivada' and new.estado = 'activa' then
    raise exception 'Archived versions cannot be reactivated: create a new version with those values' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger parametros_calculo_inmutables before update on public.parametros_calculo
  for each row execute function public.proteger_parametros_calculo();

-- Creates a new active version (archiving the current one) in one transaction
create function public.crear_version_parametros(p_tecnica text, p_valores jsonb, p_notas text default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version integer;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.parametros_calculo where tecnica = p_tecnica;
  update public.parametros_calculo set estado = 'archivada' where tecnica = p_tecnica and estado = 'activa';
  insert into public.parametros_calculo (tecnica, version, estado, valores, notas)
  values (p_tecnica, v_version, 'activa', p_valores, p_notas);
  return v_version;
end;
$$;

alter table public.parametros_calculo enable row level security;
create policy parametros_lectura on public.parametros_calculo
  for select to authenticated using (public.es_propietario());
create policy parametros_alta on public.parametros_calculo
  for insert to authenticated with check (public.es_propietario());
create policy parametros_archivo on public.parametros_calculo
  for update to authenticated using (public.es_propietario()) with check (public.es_propietario());

grant select, insert on public.parametros_calculo to authenticated;
grant update (estado) on public.parametros_calculo to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.parametros_calculo to service_role;
grant execute on function public.crear_version_parametros(text, jsonb, text) to authenticated;
revoke all on public.parametros_calculo from anon;
revoke execute on function public.crear_version_parametros(text, jsonb, text) from anon, public;
revoke execute on function public.proteger_parametros_calculo() from anon, public;
