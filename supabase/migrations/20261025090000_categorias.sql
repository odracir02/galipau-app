-- Catalogue categories managed by the owner, and bulk classification of models.
--
-- * modelos.tipo stays THE classification (calculator, quotes and filters use
--   it); categorias is the owner's list of allowed values, with an order. A
--   foreign key keeps both consistent: renaming a category renames it in its
--   models (on update cascade) and a category in use cannot be deleted.
-- * A type that is not in the list yet (an import, the model form, an older
--   function) is added to it automatically, with the spelling of the existing
--   category when only the case differs, so nothing that writes models breaks.
-- * clasificar_modelos changes ONLY modelos.tipo of the given models and logs
--   each change in a batch that can be undone; prices, VAT, references,
--   variants, archived state, quotes and stock are never touched.
--
-- Safety: adds tables, a trigger, a foreign key and functions; fills the list
-- with the types already in use. No model or price changes. Re-runnable.

create table if not exists public.categorias (
  id bigint generated always as identity primary key,
  nombre text not null unique check (length(trim(nombre)) > 0 and nombre = trim(nombre)),
  orden integer not null default 0,
  creada_en timestamptz not null default now()
);
create unique index if not exists categorias_nombre_ci on public.categorias (lower(nombre));

-- The types in use (one spelling per name, ignoring case). No other rows are added here, so a
-- backup can be restored on top of the migrations; "Sin clasificar" and any new type are added
-- by the trigger below the first time a model uses them.
insert into public.categorias (nombre, orden)
select distinct on (lower(trim(tipo))) trim(tipo), 0 from public.modelos order by lower(trim(tipo)), trim(tipo)
on conflict do nothing;
-- models whose type differed only in case/spaces take the list's spelling
update public.modelos m set tipo = c.nombre
  from public.categorias c
  where lower(trim(m.tipo)) = lower(c.nombre) and m.tipo <> c.nombre;

-- Any type written to a model exists in the list (same spelling as the list, ignoring case)
create or replace function public.categoria_de_modelo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_nombre text;
begin
  new.tipo := trim(new.tipo);
  select nombre into v_nombre from public.categorias where lower(nombre) = lower(new.tipo);
  if v_nombre is null then
    insert into public.categorias (nombre, orden)
    values (new.tipo, coalesce((select max(orden) from public.categorias where nombre <> 'Sin clasificar'), 0) + 1)
    returning nombre into v_nombre;
  end if;
  new.tipo := v_nombre;
  return new;
end;
$$;
drop trigger if exists modelos_categoria on public.modelos;
create trigger modelos_categoria before insert or update of tipo on public.modelos
  for each row execute function public.categoria_de_modelo();

alter table public.modelos drop constraint if exists modelos_tipo_categoria_fkey;
alter table public.modelos add constraint modelos_tipo_categoria_fkey
  foreign key (tipo) references public.categorias (nombre) on update cascade on delete restrict;

-- Log of bulk classifications (one batch per action), to review and undo
create table if not exists public.clasificacion_cambios (
  id bigint generated always as identity primary key,
  lote uuid not null,
  modelo_id bigint not null references public.modelos on delete cascade,
  antes text not null,
  despues text not null,
  usuario uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index if not exists clasificacion_cambios_lote_idx on public.clasificacion_cambios (lote);

/*
 * Sets the category of the given models. Returns { lote, cambiados, sin_cambio }.
 * Only modelos.tipo changes; models already in that category are left alone.
 */
create or replace function public.clasificar_modelos(p_modelos bigint[], p_categoria text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cat text;
  v_lote uuid := gen_random_uuid();
  v_cambiados integer;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select nombre into v_cat from public.categorias where lower(nombre) = lower(trim(p_categoria));
  if v_cat is null then
    raise exception 'Category % does not exist', p_categoria using errcode = 'P0002';
  end if;
  with cambio as (
    select m.id, m.tipo from public.modelos m where m.id = any(p_modelos) and m.tipo is distinct from v_cat for update
  ), log as (
    insert into public.clasificacion_cambios (lote, modelo_id, antes, despues) select v_lote, id, tipo, v_cat from cambio returning modelo_id
  )
  update public.modelos m set tipo = v_cat from log where m.id = log.modelo_id;
  get diagnostics v_cambiados = row_count;
  return jsonb_build_object('lote', v_lote, 'cambiados', v_cambiados, 'sin_cambio', coalesce(array_length(p_modelos, 1), 0) - v_cambiados);
end;
$$;

-- Undoes a classification batch: a model goes back only if nobody changed its category since
create or replace function public.deshacer_clasificacion(p_lote uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.modelos m set tipo = c.antes
    from public.clasificacion_cambios c
    where c.lote = p_lote and m.id = c.modelo_id and m.tipo = c.despues
      and exists (select 1 from public.categorias k where k.nombre = c.antes);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Moves every model of one category to another and removes the first (logged, can be undone while both exist)
create or replace function public.fusionar_categorias(p_origen text, p_destino text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_origen text;
  v_destino text;
  v_ids bigint[];
  r jsonb;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select nombre into v_origen from public.categorias where lower(nombre) = lower(trim(p_origen));
  select nombre into v_destino from public.categorias where lower(nombre) = lower(trim(p_destino));
  if v_origen is null or v_destino is null or v_origen = v_destino then
    raise exception 'Invalid categories to merge' using errcode = '22023';
  end if;
  if v_origen = 'Sin clasificar' then
    raise exception 'Sin clasificar cannot be removed' using errcode = '22023';
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.modelos where tipo = v_origen;
  r := public.clasificar_modelos(v_ids, v_destino);
  delete from public.categorias where nombre = v_origen;
  return r;
end;
$$;

alter table public.categorias enable row level security;
alter table public.clasificacion_cambios enable row level security;
drop policy if exists categorias_propietario on public.categorias;
drop policy if exists clasificacion_cambios_lectura on public.clasificacion_cambios;
drop policy if exists clasificacion_cambios_alta on public.clasificacion_cambios;
create policy categorias_propietario on public.categorias for all to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy clasificacion_cambios_lectura on public.clasificacion_cambios for select to authenticated using (public.es_propietario());
create policy clasificacion_cambios_alta on public.clasificacion_cambios for insert to authenticated with check (public.es_propietario());

revoke all on public.categorias, public.clasificacion_cambios from anon;
grant select, insert, update, delete on public.categorias to authenticated;
grant select, insert on public.clasificacion_cambios to authenticated;
grant select on public.categorias, public.clasificacion_cambios to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

revoke execute on function public.categoria_de_modelo() from anon, public;
revoke execute on function public.clasificar_modelos(bigint[], text) from anon, public;
revoke execute on function public.deshacer_clasificacion(uuid) from anon, public;
revoke execute on function public.fusionar_categorias(text, text) from anon, public;
grant execute on function public.clasificar_modelos(bigint[], text) to authenticated;
grant execute on function public.deshacer_clasificacion(uuid) to authenticated;
grant execute on function public.fusionar_categorias(text, text) to authenticated;
