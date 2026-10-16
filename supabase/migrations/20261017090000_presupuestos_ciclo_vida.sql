-- Persistent quotes: lifecycle, numbering, economic snapshot and reversible
-- imports of historical data.
--
-- * A quote is created as a draft without number. It receives its number
--   (e.g. 2026/003) when it is first presented, from a gap-free counter, so
--   numbers are unique and never reused.
-- * The economic snapshot (engine input, full result, engine version and the
--   parameter version used) makes every quote reproducible later, whatever
--   happens to parameters or catalogue.
-- * State changes follow an explicit transition table, enforced here, and are
--   logged. Content can only be edited while the quote is a draft or presented.
--   `notas` are internal (never printed); `observaciones` and `condiciones`
--   are printed on the customer document.
-- * Quotes are never deleted, except rows created by an import, which can be
--   reverted as a whole.

-- ---------------------------------------------------------------------------
-- Imports (history from the browser, catalogue from Firestore)
-- ---------------------------------------------------------------------------
create table public.importaciones (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('historial_local', 'catalogo_firestore')),
  creada_en timestamptz not null default now(),
  resumen jsonb not null default '{}'::jsonb check (jsonb_typeof(resumen) = 'object'),
  revertida_en timestamptz
);

alter table public.proveedores add column importacion_id bigint references public.importaciones on delete restrict;
alter table public.modelos add column importacion_id bigint references public.importaciones on delete restrict;
alter table public.variantes add column importacion_id bigint references public.importaciones on delete restrict;

-- ---------------------------------------------------------------------------
-- Quotes: new states and snapshot columns
-- ---------------------------------------------------------------------------
alter table public.presupuestos drop constraint presupuestos_estado_check;
update public.presupuestos set estado = case estado
  when 'enviado' then 'presentado'
  when 'convertido' then 'aceptado'
  when 'rechazado' then 'cancelado'
  when 'caducado' then 'cancelado'
  else estado end;
alter table public.presupuestos add constraint presupuestos_estado_check
  check (estado in ('borrador', 'presentado', 'aceptado', 'en_produccion', 'finalizado', 'cobrado', 'cancelado', 'importado'));

alter table public.presupuestos alter column numero drop not null;

alter table public.presupuestos
  add column tecnica text check (tecnica is null or tecnica in ('serigrafia', 'dtf')),
  add column parametros_version integer,
  add column cliente_datos jsonb not null default '{}'::jsonb check (jsonb_typeof(cliente_datos) = 'object'),
  add column idioma text not null default 'es' check (idioma in ('es', 'va')),
  add column observaciones text,
  add column condiciones text,
  add column coste_total_cent bigint,
  add column precio_recomendado_cent bigint check (precio_recomendado_cent is null or precio_recomendado_cent >= 0),
  add column precio_final_cent bigint check (precio_final_cent is null or precio_final_cent >= 0),
  add column beneficio_cent bigint,
  add column historial_estados jsonb not null default '[]'::jsonb check (jsonb_typeof(historial_estados) = 'array'),
  add column importacion_id bigint references public.importaciones on delete restrict,
  add constraint presupuestos_parametros_fk foreign key (tecnica, parametros_version)
    references public.parametros_calculo (tecnica, version) on delete restrict;

-- Rows already marked 'importado' by the previous schema join one import batch
with lote as (
  insert into public.importaciones (tipo, resumen)
  select 'historial_local', '{"origen": "previous schema"}'::jsonb
  where exists (select 1 from public.presupuestos where estado = 'importado')
  returning id
)
update public.presupuestos set importacion_id = (select id from lote) where estado = 'importado';

alter table public.presupuestos
  add constraint presupuestos_importado_check check ((estado = 'importado') = (importacion_id is not null));

create index presupuestos_estado_idx on public.presupuestos (estado);
create index presupuestos_creado_idx on public.presupuestos (creado_en desc);
-- The same historical record can only be imported once
create unique index presupuestos_huella_importacion on public.presupuestos ((entrada -> 'origen' ->> 'huella'))
  where estado = 'importado';

-- ---------------------------------------------------------------------------
-- Quote numbers: YYYY/NNN (NNN grows past 999 without truncation)
-- ---------------------------------------------------------------------------
create function public.siguiente_numero_presupuesto(p_anio integer)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ultimo integer;
begin
  insert into public.contadores (serie, anio, ultimo) values ('PRES', p_anio, 1)
  on conflict (serie, anio) do update set ultimo = public.contadores.ultimo + 1
  returning ultimo into v_ultimo;
  return p_anio || '/' || case when v_ultimo < 1000 then lpad(v_ultimo::text, 3, '0') else v_ultimo::text end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lifecycle
-- ---------------------------------------------------------------------------
create function public.transicion_presupuesto_permitida(p_desde text, p_hasta text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_desde, p_hasta) in (
    ('borrador', 'presentado'), ('borrador', 'cancelado'),
    ('presentado', 'borrador'), ('presentado', 'aceptado'), ('presentado', 'cancelado'),
    ('aceptado', 'presentado'), ('aceptado', 'en_produccion'), ('aceptado', 'cancelado'),
    ('en_produccion', 'aceptado'), ('en_produccion', 'finalizado'), ('en_produccion', 'cancelado'),
    ('finalizado', 'en_produccion'), ('finalizado', 'cobrado'),
    ('cobrado', 'finalizado')
  );
$$;

create function public.controlar_presupuesto()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_contenido_cambia boolean;
begin
  -- Rules apply to the app (Data API roles). Trusted roles, e.g. a backup
  -- restore loading rows exactly as they were, are not restricted.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.estado not in ('borrador', 'importado') then
      raise exception 'A new quote must start as a draft' using errcode = '23514';
    end if;
    if new.numero is not null and new.estado <> 'importado' then
      raise exception 'Quote numbers are assigned when the quote is presented' using errcode = '23514';
    end if;
    new.historial_estados := jsonb_build_array(jsonb_build_object('estado', new.estado, 'en', now()));
    new.version := 1;
    return new;
  end if;

  -- UPDATE
  if old.estado = 'importado' then
    if (to_jsonb(new) - 'notas' - 'actualizado_en') = (to_jsonb(old) - 'notas' - 'actualizado_en') then
      return new; -- only the notes changed
    end if;
    raise exception 'Imported quotes are read-only (revert the import instead)' using errcode = '42501';
  end if;
  if new.numero is distinct from old.numero and not (old.numero is null and new.estado = 'presentado' and old.estado = 'borrador') then
    raise exception 'The quote number cannot be changed' using errcode = '42501';
  end if;
  if new.importacion_id is distinct from old.importacion_id then
    raise exception 'The import link cannot be changed' using errcode = '42501';
  end if;

  v_contenido_cambia := row(new.cliente_id, new.cliente_nombre, new.cliente_datos, new.tecnica, new.motor, new.entrada,
      new.resultado, new.parametros_version, new.total_cent, new.coste_total_cent, new.precio_recomendado_cent,
      new.precio_final_cent, new.beneficio_cent, new.idioma, new.observaciones, new.condiciones, new.fecha_emision, new.valido_hasta)
    is distinct from row(old.cliente_id, old.cliente_nombre, old.cliente_datos, old.tecnica, old.motor, old.entrada,
      old.resultado, old.parametros_version, old.total_cent, old.coste_total_cent, old.precio_recomendado_cent,
      old.precio_final_cent, old.beneficio_cent, old.idioma, old.observaciones, old.condiciones, old.fecha_emision, old.valido_hasta);
  if v_contenido_cambia and old.estado not in ('borrador', 'presentado') then
    raise exception 'Only draft or presented quotes can be edited (current state: %)', old.estado using errcode = '42501';
  end if;
  if v_contenido_cambia and old.estado = 'presentado' then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;

  -- The state log can only grow through state changes
  new.historial_estados := old.historial_estados;
  if new.estado is distinct from old.estado then
    if not public.transicion_presupuesto_permitida(old.estado, new.estado) then
      raise exception 'State change not allowed: % -> %', old.estado, new.estado using errcode = '23514';
    end if;
    if new.estado <> 'cancelado' and new.estado <> 'borrador'
       and (new.precio_final_cent is null or new.precio_final_cent <= 0 or new.resultado is null) then
      raise exception 'A quote needs a calculated result and a final price before it is presented' using errcode = '23514';
    end if;
    if new.estado = 'presentado' and new.numero is null then
      new.numero := public.siguiente_numero_presupuesto(extract(year from new.fecha_emision)::integer);
    end if;
    new.historial_estados := old.historial_estados || jsonb_build_object('estado', new.estado, 'en', now());
  end if;
  return new;
end;
$$;

create trigger presupuestos_control before insert or update on public.presupuestos
  for each row execute function public.controlar_presupuesto();

-- ---------------------------------------------------------------------------
-- Imports: one transaction each, reversible as a whole
-- ---------------------------------------------------------------------------
-- p_registros: [{ huella, cliente_nombre, fecha (date), total_cent, original (object) }]
create function public.importar_historial(p_registros jsonb, p_resumen jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
  r jsonb;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_registros) <> 'array' or jsonb_array_length(p_registros) = 0 then
    raise exception 'Nothing to import' using errcode = '22023';
  end if;
  insert into public.importaciones (tipo, resumen) values ('historial_local', coalesce(p_resumen, '{}'::jsonb)) returning id into v_id;
  for r in select * from jsonb_array_elements(p_registros) loop
    insert into public.presupuestos (estado, importacion_id, cliente_nombre, fecha_emision, motor, entrada, total_cent, notas)
    values ('importado', v_id, coalesce(nullif(trim(r ->> 'cliente_nombre'), ''), '(sin nombre)'),
      coalesce((r ->> 'fecha')::date, current_date), 'legacy',
      jsonb_build_object('origen', jsonb_build_object('tipo', 'localStorage', 'huella', r ->> 'huella', 'importacion', v_id), 'original', r -> 'original'),
      (r ->> 'total_cent')::bigint, 'Importado del historial del navegador');
  end loop;
  return v_id;
end;
$$;

-- p_filas: [{ proveedor, tipo, modelo, talla, color, coste_cent }] (already checked for conflicts)
-- Existing suppliers/models/variants (matched ignoring case) are reused and never modified.
create function public.importar_catalogo(p_filas jsonb, p_resumen jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
  r jsonb;
  v_proveedor bigint;
  v_modelo bigint;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'Nothing to import' using errcode = '22023';
  end if;
  insert into public.importaciones (tipo, resumen) values ('catalogo_firestore', coalesce(p_resumen, '{}'::jsonb)) returning id into v_id;
  for r in select * from jsonb_array_elements(p_filas) loop
    select id into v_proveedor from public.proveedores where lower(nombre) = lower(r ->> 'proveedor');
    if v_proveedor is null then
      insert into public.proveedores (nombre, importacion_id) values (r ->> 'proveedor', v_id) returning id into v_proveedor;
    end if;
    select id into v_modelo from public.modelos
      where proveedor_id = v_proveedor and lower(tipo) = lower(r ->> 'tipo') and lower(nombre) = lower(r ->> 'modelo');
    if v_modelo is null then
      insert into public.modelos (proveedor_id, tipo, nombre, importacion_id) values (v_proveedor, r ->> 'tipo', r ->> 'modelo', v_id) returning id into v_modelo;
    end if;
    if not exists (select 1 from public.variantes
                   where modelo_id = v_modelo and lower(color) = lower(r ->> 'color') and lower(talla) = lower(r ->> 'talla')) then
      insert into public.variantes (modelo_id, color, talla, coste_cent, importacion_id)
      values (v_modelo, r ->> 'color', r ->> 'talla', (r ->> 'coste_cent')::integer, v_id);
    end if;
  end loop;
  return v_id;
end;
$$;

create function public.revertir_importacion(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.importaciones where id = p_id and revertida_en is null) then
    raise exception 'Import not found or already reverted' using errcode = '22023';
  end if;
  delete from public.presupuestos where importacion_id = p_id and estado = 'importado';
  delete from public.variantes where importacion_id = p_id;
  delete from public.modelos m where m.importacion_id = p_id and not exists (select 1 from public.variantes v where v.modelo_id = m.id);
  delete from public.proveedores p where p.importacion_id = p_id and not exists (select 1 from public.modelos m where m.proveedor_id = p.id);
  update public.importaciones set revertida_en = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------
alter table public.importaciones enable row level security;
create policy importaciones_lectura on public.importaciones
  for select to authenticated using (public.es_propietario());
create policy importaciones_alta on public.importaciones
  for insert to authenticated with check (public.es_propietario());
create policy importaciones_cambio on public.importaciones
  for update to authenticated using (public.es_propietario()) with check (public.es_propietario());

-- Quotes are kept forever: only rows created by an import can be deleted
drop policy presupuestos_propietario on public.presupuestos;
create policy presupuestos_lectura on public.presupuestos
  for select to authenticated using (public.es_propietario());
create policy presupuestos_alta on public.presupuestos
  for insert to authenticated with check (public.es_propietario());
create policy presupuestos_cambio on public.presupuestos
  for update to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy presupuestos_baja_importados on public.presupuestos
  for delete to authenticated using (public.es_propietario() and estado = 'importado');

grant select, insert on public.importaciones to authenticated;
grant update (revertida_en) on public.importaciones to authenticated;
grant select on public.importaciones to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on function public.siguiente_numero_presupuesto(integer) to authenticated;
grant execute on function public.transicion_presupuesto_permitida(text, text) to authenticated;
grant execute on function public.importar_historial(jsonb, jsonb) to authenticated;
grant execute on function public.importar_catalogo(jsonb, jsonb) to authenticated;
grant execute on function public.revertir_importacion(bigint) to authenticated;
revoke all on public.importaciones from anon;
revoke execute on function public.siguiente_numero_presupuesto(integer) from anon, public;
revoke execute on function public.transicion_presupuesto_permitida(text, text) from anon, public;
revoke execute on function public.controlar_presupuesto() from anon, public;
revoke execute on function public.importar_historial(jsonb, jsonb) from anon, public;
revoke execute on function public.importar_catalogo(jsonb, jsonb) from anon, public;
revoke execute on function public.revertir_importacion(bigint) from anon, public;
