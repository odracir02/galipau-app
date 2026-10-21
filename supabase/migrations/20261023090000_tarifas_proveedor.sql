-- Supplier price-list imports (reusable for any supplier file).
--
-- * Alternative price modes per variant (e.g. box / pack / unit) are kept in
--   variantes_tarifas; the supplier's chosen mode (proveedores.modalidad_tarifa)
--   is the one copied into the variant price used by quotes.
-- * Every import is one transaction that logs each change (before/after) in
--   importaciones_cambios, so it can be reviewed and reverted safely: a price
--   is only restored if nobody changed it afterwards, and a variant created by
--   the import is archived instead of deleted when quotes or stock use it.
-- * Price changes never touch stock, reservations, movements or saved quotes
--   (quotes keep their prices in their own snapshot).
-- * A large price list is sent in numbered batches (each one a transaction,
--   well below the API statement timeout) under a client key (p_clave): the
--   first batch creates the import, the next ones add to it in order and the
--   last one marks it complete. Repeating a batch already saved (e.g. when the
--   response was lost) does nothing, so a retry never duplicates; an import
--   that stopped half-way stays "en_curso" with the batches applied, and can be
--   resumed from the next batch or reverted.
-- * The brand (modelos.marca) is shown in the catalogue views for filtering;
--   an import only FILLS an empty brand or reference of an existing model.
-- * variantes.modalidad records which price mode gives the variant price.
--
-- Safety: adds tables, columns, an index and functions; widens one check;
-- the two catalogue views keep their columns and gain "marca". No data is
-- deleted or updated. Re-runnable.

alter table public.modelos add column if not exists marca text;
alter table public.proveedores add column if not exists modalidad_tarifa text;
alter table public.variantes add column if not exists modalidad text;
create index if not exists modelos_referencia_idx on public.modelos (proveedor_id, referencia) where referencia is not null;

alter table public.importaciones add column if not exists usuario uuid default auth.uid();
alter table public.importaciones add column if not exists proveedor_id bigint references public.proveedores on delete restrict;
alter table public.importaciones add column if not exists clave uuid unique; -- client key of a batched import
alter table public.importaciones drop constraint if exists importaciones_tipo_check;
alter table public.importaciones add constraint importaciones_tipo_check
  check (tipo in ('historial_local', 'catalogo_firestore', 'tarifa_proveedor'));

create table if not exists public.variantes_tarifas (
  id bigint generated always as identity primary key,
  variante_id bigint not null references public.variantes on delete cascade,
  modalidad text not null check (length(trim(modalidad)) > 0),
  precio numeric(12, 4) not null check (precio >= 0),
  unidades integer check (unidades is null or unidades > 0), -- units per box/pack, if the supplier says so
  importacion_id bigint references public.importaciones on delete set null,
  actualizado_en timestamptz not null default now(),
  unique (variante_id, modalidad)
);

create table if not exists public.importaciones_cambios (
  id bigint generated always as identity primary key,
  importacion_id bigint not null references public.importaciones on delete cascade,
  accion text not null check (accion in ('alta_proveedor', 'alta_modelo', 'alta_variante', 'precio', 'archivar', 'tarifas', 'datos_modelo')),
  proveedor_id bigint,
  modelo_id bigint,
  variante_id bigint,
  antes jsonb,
  despues jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists importaciones_cambios_importacion_idx on public.importaciones_cambios (importacion_id, id);

-- Current price columns of a variant as JSON (for the change log)
create or replace function public.precio_variante_json(v public.variantes)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('precio_neto', v.precio_neto, 'iva_porcentaje', v.iva_porcentaje, 'precio_compra', v.precio_compra, 'coste_cent', v.coste_cent, 'modalidad', v.modalidad);
$$;

-- Price modes of a variant as JSON (for the change log)
create or replace function public.tarifas_variante_json(p_variante_id bigint)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('modalidad', t.modalidad, 'precio', t.precio, 'unidades', t.unidades) order by t.modalidad), '[]'::jsonb)
  from public.variantes_tarifas t where t.variante_id = p_variante_id;
$$;

create or replace function public.guardar_tarifas_variante(p_variante_id bigint, p_tarifas jsonb, p_importacion_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  t jsonb;
begin
  for t in select * from jsonb_array_elements(coalesce(p_tarifas, '[]'::jsonb)) loop
    insert into public.variantes_tarifas (variante_id, modalidad, precio, unidades, importacion_id)
    values (p_variante_id, t ->> 'modalidad', (t ->> 'precio')::numeric, nullif(t ->> 'unidades', '')::integer, p_importacion_id)
    on conflict (variante_id, modalidad) do update
      set precio = excluded.precio, unidades = excluded.unidades, importacion_id = excluded.importacion_id, actualizado_en = now();
  end loop;
end;
$$;

-- Fills an empty reference and/or brand of an existing model (never overwrites); logs what changed
create or replace function public.completar_datos_modelo(p_importacion_id bigint, p_modelo_id bigint, p_referencia text, p_marca text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m public.modelos;
  v_antes jsonb := '{}'::jsonb;
  v_despues jsonb := '{}'::jsonb;
begin
  select * into m from public.modelos where id = p_modelo_id for update;
  if not found then
    raise exception 'Model % not found', p_modelo_id using errcode = 'P0002';
  end if;
  if m.referencia is null and nullif(trim(p_referencia), '') is not null then
    v_antes := v_antes || jsonb_build_object('referencia', null);
    v_despues := v_despues || jsonb_build_object('referencia', trim(p_referencia));
  end if;
  if m.marca is null and nullif(trim(p_marca), '') is not null then
    v_antes := v_antes || jsonb_build_object('marca', null);
    v_despues := v_despues || jsonb_build_object('marca', trim(p_marca));
  end if;
  if v_despues = '{}'::jsonb then
    return;
  end if;
  update public.modelos
    set referencia = coalesce(referencia, v_despues ->> 'referencia'), marca = coalesce(marca, v_despues ->> 'marca')
    where id = p_modelo_id;
  insert into public.importaciones_cambios (importacion_id, accion, modelo_id, antes, despues) values (p_importacion_id, 'datos_modelo', p_modelo_id, v_antes, v_despues);
end;
$$;

/*
 * p_meta: { proveedor_id?, proveedor_nombre?, modalidad, interpretacion, archivo: { nombre, sha256, formato }, resumen }
 * p_operaciones: [
 *   { accion: 'alta', modelo: { nombre, referencia, tipo, marca, descripcion }, color, talla, precio: { precio_neto, iva_porcentaje, precio_compra }, coste_cent, tarifas: [...] },
 *   { accion: 'precio', variante_id, precio: {...}, coste_cent, tarifas: [...] },
 *   { accion: 'tarifas', variante_id, tarifas: [...] },
 *   { accion: 'archivar', variante_id },
 *   { accion: 'completar_modelo', modelo_id, referencia, marca }   (fills empty fields only)
 * 'alta' and 'precio' may carry `modalidad`: the price mode their price comes from.
 * ]
 * Only the operations the owner accepted in the preview are sent.
 * p_clave: one key per import (generated by the client); p_lote: 1..p_total.
 */
-- An earlier draft of this function had another signature
drop function if exists public.importar_tarifa(jsonb, jsonb);
drop function if exists public.importar_tarifa(jsonb, jsonb, bigint);

create or replace function public.importar_tarifa(p_meta jsonb, p_operaciones jsonb, p_clave uuid, p_lote integer, p_total integer)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_imp bigint;
  v_prov bigint := nullif(p_meta ->> 'proveedor_id', '')::bigint;
  op jsonb;
  v_mod bigint;
  v_var public.variantes;
  v_id bigint;
  v_antes jsonb;
  v_imp_row public.importaciones;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_operaciones) <> 'array' or jsonb_array_length(p_operaciones) = 0 then
    raise exception 'Nothing to import' using errcode = '22023';
  end if;
  if p_clave is null or p_lote is null or p_total is null or p_lote < 1 or p_lote > p_total then
    raise exception 'Invalid batch % of %', p_lote, p_total using errcode = '22023';
  end if;
  -- serialise batches of the same import, then find it by its key
  perform pg_advisory_xact_lock(hashtextextended(p_clave::text, 0));
  select * into v_imp_row from public.importaciones where clave = p_clave for update;
  if found then
    v_imp := v_imp_row.id;
    v_prov := v_imp_row.proveedor_id;
    if v_imp_row.tipo <> 'tarifa_proveedor' then
      raise exception 'Not a price-list import' using errcode = '22023';
    end if;
    if p_lote <= coalesce((v_imp_row.resumen ->> 'lotes_aplicados')::int, 0) then
      return v_imp; -- already saved (repeated call): nothing to do, nothing duplicated
    end if;
    if v_imp_row.revertida_en is not null then
      raise exception 'Price-list import % was reverted', v_imp using errcode = '22023';
    end if;
    if p_lote <> coalesce((v_imp_row.resumen ->> 'lotes_aplicados')::int, 0) + 1 then
      raise exception 'Batch % out of order: % applied', p_lote, v_imp_row.resumen ->> 'lotes_aplicados' using errcode = '22023';
    end if;
    update public.importaciones
      set resumen = resumen || jsonb_build_object('lotes_aplicados', p_lote, 'estado', case when p_lote = p_total then 'completa' else 'en_curso' end)
      where id = v_imp;
  else
    if p_lote <> 1 then
      raise exception 'Batch % of an import that does not exist', p_lote using errcode = '22023';
    end if;
    insert into public.importaciones (tipo, clave, resumen)
    values ('tarifa_proveedor', p_clave, (coalesce(p_meta, '{}'::jsonb) - 'proveedor_id')
            || jsonb_build_object('lotes_total', p_total, 'lotes_aplicados', 1, 'estado', case when p_total = 1 then 'completa' else 'en_curso' end))
    returning id into v_imp;
    if v_prov is null then
      select id into v_prov from public.proveedores where lower(nombre) = lower(trim(p_meta ->> 'proveedor_nombre'));
      if v_prov is null then
        insert into public.proveedores (nombre, importacion_id) values (trim(p_meta ->> 'proveedor_nombre'), v_imp) returning id into v_prov;
        insert into public.importaciones_cambios (importacion_id, accion, proveedor_id) values (v_imp, 'alta_proveedor', v_prov);
      end if;
    end if;
    update public.importaciones set proveedor_id = v_prov where id = v_imp;
    if nullif(p_meta ->> 'modalidad', '') is not null then
      update public.proveedores set modalidad_tarifa = p_meta ->> 'modalidad' where id = v_prov;
    end if;
  end if;

  for op in select * from jsonb_array_elements(p_operaciones) loop
    if op ->> 'accion' = 'alta' then
      -- Model: the one chosen in the preview, else same reference, else same name (ignoring case); created if missing
      v_mod := null;
      if nullif(op -> 'modelo' ->> 'id', '') is not null then
        select id into v_mod from public.modelos where id = (op -> 'modelo' ->> 'id')::bigint and proveedor_id = v_prov;
        if v_mod is null then
          raise exception 'Model % does not belong to this supplier', op -> 'modelo' ->> 'id' using errcode = 'P0002';
        end if;
      end if;
      if v_mod is null and nullif(op -> 'modelo' ->> 'referencia', '') is not null then
        select id into v_mod from public.modelos where proveedor_id = v_prov and referencia = op -> 'modelo' ->> 'referencia' order by id limit 1;
      end if;
      if v_mod is null then
        select id into v_mod from public.modelos where proveedor_id = v_prov and lower(nombre) = lower(op -> 'modelo' ->> 'nombre') limit 1;
      end if;
      if v_mod is null then
        insert into public.modelos (proveedor_id, tipo, nombre, referencia, marca, descripcion, importacion_id)
        values (v_prov, op -> 'modelo' ->> 'tipo', op -> 'modelo' ->> 'nombre', nullif(op -> 'modelo' ->> 'referencia', ''),
                nullif(op -> 'modelo' ->> 'marca', ''), nullif(op -> 'modelo' ->> 'descripcion', ''), v_imp)
        returning id into v_mod;
        insert into public.importaciones_cambios (importacion_id, accion, proveedor_id, modelo_id) values (v_imp, 'alta_modelo', v_prov, v_mod);
      else
        -- an existing model only gets an empty reference or brand filled (nothing else changes)
        perform public.completar_datos_modelo(v_imp, v_mod, op -> 'modelo' ->> 'referencia', op -> 'modelo' ->> 'marca');
      end if;
      insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje, precio_compra, modalidad, importacion_id)
      values (v_mod, op ->> 'color', op ->> 'talla', coalesce((op ->> 'coste_cent')::integer, 0),
              (op -> 'precio' ->> 'precio_neto')::numeric, (op -> 'precio' ->> 'iva_porcentaje')::numeric, (op -> 'precio' ->> 'precio_compra')::numeric,
              nullif(op ->> 'modalidad', ''), v_imp)
      returning id into v_id;
      perform public.guardar_tarifas_variante(v_id, op -> 'tarifas', v_imp);
      insert into public.importaciones_cambios (importacion_id, accion, modelo_id, variante_id, despues)
      values (v_imp, 'alta_variante', v_mod, v_id, (select public.precio_variante_json(x) from public.variantes x where x.id = v_id) || jsonb_build_object('tarifas', public.tarifas_variante_json(v_id)));

    elsif op ->> 'accion' = 'precio' then
      select * into v_var from public.variantes where id = (op ->> 'variante_id')::bigint for update;
      if not found then
        raise exception 'Variant % not found', op ->> 'variante_id' using errcode = 'P0002';
      end if;
      v_antes := public.precio_variante_json(v_var) || jsonb_build_object('tarifas', public.tarifas_variante_json(v_var.id));
      update public.variantes
        set precio_neto = (op -> 'precio' ->> 'precio_neto')::numeric, iva_porcentaje = (op -> 'precio' ->> 'iva_porcentaje')::numeric,
            precio_compra = (op -> 'precio' ->> 'precio_compra')::numeric, coste_cent = coalesce((op ->> 'coste_cent')::integer, coste_cent),
            modalidad = coalesce(nullif(op ->> 'modalidad', ''), modalidad)
        where id = v_var.id
        returning * into v_var;
      perform public.guardar_tarifas_variante(v_var.id, op -> 'tarifas', v_imp);
      insert into public.importaciones_cambios (importacion_id, accion, variante_id, antes, despues)
      values (v_imp, 'precio', v_var.id, v_antes, public.precio_variante_json(v_var) || jsonb_build_object('tarifas', public.tarifas_variante_json(v_var.id)));

    elsif op ->> 'accion' = 'tarifas' then
      v_id := (op ->> 'variante_id')::bigint;
      v_antes := public.tarifas_variante_json(v_id);
      perform public.guardar_tarifas_variante(v_id, op -> 'tarifas', v_imp);
      insert into public.importaciones_cambios (importacion_id, accion, variante_id, antes, despues)
      values (v_imp, 'tarifas', v_id, jsonb_build_object('tarifas', v_antes), jsonb_build_object('tarifas', public.tarifas_variante_json(v_id)));

    elsif op ->> 'accion' = 'archivar' then
      update public.variantes set activo = false where id = (op ->> 'variante_id')::bigint and activo;
      if found then
        insert into public.importaciones_cambios (importacion_id, accion, variante_id) values (v_imp, 'archivar', (op ->> 'variante_id')::bigint);
      end if;

    elsif op ->> 'accion' = 'completar_modelo' then
      if not exists (select 1 from public.modelos where id = (op ->> 'modelo_id')::bigint and proveedor_id = v_prov) then
        raise exception 'Model % does not belong to this supplier', op ->> 'modelo_id' using errcode = 'P0002';
      end if;
      perform public.completar_datos_modelo(v_imp, (op ->> 'modelo_id')::bigint, op ->> 'referencia', op ->> 'marca');
    else
      raise exception 'Unknown operation %', op ->> 'accion' using errcode = '22023';
    end if;
  end loop;
  return v_imp;
end;
$$;

-- Restores the previous price modes recorded in the log
create or replace function public.restaurar_tarifas_variante(p_variante_id bigint, p_tarifas jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.variantes_tarifas where variante_id = p_variante_id;
  perform public.guardar_tarifas_variante(p_variante_id, p_tarifas, null);
end;
$$;

/*
 * Reverts a supplier price-list import, newest change first. Returns a summary:
 * { precios_restaurados, precios_conservados (changed later: left as they are),
 *   variantes_borradas, variantes_archivadas (in use), variantes_conservadas
 *   (changed later by hand or by another import: kept), modelos_borrados, ... }
 * Works for an import that stopped half-way too.
 */
create or replace function public.revertir_tarifa(p_importacion_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.importaciones_cambios;
  v public.variantes;
  r jsonb := jsonb_build_object('precios_restaurados', 0, 'precios_conservados', 0, 'variantes_borradas', 0, 'variantes_archivadas', 0, 'variantes_conservadas', 0,
                                'reactivadas', 0, 'tarifas_restauradas', 0, 'modelos_borrados', 0, 'proveedores_borrados', 0, 'datos_modelo_restaurados', 0);
  en_uso boolean;
  cambiada boolean;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.importaciones where id = p_importacion_id and tipo = 'tarifa_proveedor' and revertida_en is null) then
    raise exception 'Price-list import not found or already reverted' using errcode = '22023';
  end if;
  for c in select * from public.importaciones_cambios where importacion_id = p_importacion_id order by id desc loop
    if c.accion = 'precio' then
      select * into v from public.variantes where id = c.variante_id for update;
      if found and public.precio_variante_json(v) = (c.despues - 'tarifas') then
        update public.variantes
          set precio_neto = (c.antes ->> 'precio_neto')::numeric, iva_porcentaje = (c.antes ->> 'iva_porcentaje')::numeric,
              precio_compra = (c.antes ->> 'precio_compra')::numeric, coste_cent = (c.antes ->> 'coste_cent')::integer,
              modalidad = c.antes ->> 'modalidad'
          where id = v.id;
        perform public.restaurar_tarifas_variante(v.id, c.antes -> 'tarifas');
        r := jsonb_set(r, '{precios_restaurados}', to_jsonb((r ->> 'precios_restaurados')::int + 1));
      else
        r := jsonb_set(r, '{precios_conservados}', to_jsonb((r ->> 'precios_conservados')::int + 1));
      end if;
    elsif c.accion = 'tarifas' then
      if public.tarifas_variante_json(c.variante_id) = (c.despues -> 'tarifas') then
        perform public.restaurar_tarifas_variante(c.variante_id, c.antes -> 'tarifas');
        r := jsonb_set(r, '{tarifas_restauradas}', to_jsonb((r ->> 'tarifas_restauradas')::int + 1));
      end if;
    elsif c.accion = 'archivar' then
      update public.variantes set activo = true where id = c.variante_id and not activo;
      if found then r := jsonb_set(r, '{reactivadas}', to_jsonb((r ->> 'reactivadas')::int + 1)); end if;
    elsif c.accion = 'alta_variante' then
      select * into v from public.variantes where id = c.variante_id for update;
      if not found then
        continue;
      end if;
      -- changed afterwards (by hand or by another import that is still applied): a legitimate change, kept
      cambiada := (c.despues ? 'precio_neto' and public.precio_variante_json(v) <> (c.despues - 'tarifas'))
        or exists (select 1 from public.importaciones_cambios x join public.importaciones i on i.id = x.importacion_id
                   where x.variante_id = c.variante_id and x.importacion_id <> p_importacion_id and i.revertida_en is null);
      en_uso := exists (select 1 from public.stock_articulos s where s.variante_id = c.variante_id)
        or exists (select 1 from public.presupuestos p, jsonb_array_elements(coalesce(p.entrada -> 'formulario' -> 'lineas', '[]'::jsonb)) l
                   where l ->> 'productoId' = c.variante_id::text);
      if cambiada then
        r := jsonb_set(r, '{variantes_conservadas}', to_jsonb((r ->> 'variantes_conservadas')::int + 1));
      elsif en_uso then
        update public.variantes set activo = false where id = c.variante_id;
        r := jsonb_set(r, '{variantes_archivadas}', to_jsonb((r ->> 'variantes_archivadas')::int + 1));
      else
        delete from public.variantes where id = c.variante_id;
        if found then r := jsonb_set(r, '{variantes_borradas}', to_jsonb((r ->> 'variantes_borradas')::int + 1)); end if;
      end if;
    elsif c.accion = 'alta_modelo' then
      delete from public.modelos m where m.id = c.modelo_id and not exists (select 1 from public.variantes x where x.modelo_id = m.id);
      if found then
        r := jsonb_set(r, '{modelos_borrados}', to_jsonb((r ->> 'modelos_borrados')::int + 1));
      else
        update public.modelos set activo = false where id = c.modelo_id;
      end if;
    elsif c.accion = 'datos_modelo' then
      -- only fields still holding the imported value go back to empty
      update public.modelos
        set referencia = case when c.despues ? 'referencia' and referencia = c.despues ->> 'referencia' then null else referencia end,
            marca = case when c.despues ? 'marca' and marca = c.despues ->> 'marca' then null else marca end
        where id = c.modelo_id
          and ((c.despues ? 'referencia' and referencia = c.despues ->> 'referencia') or (c.despues ? 'marca' and marca = c.despues ->> 'marca'));
      if found then r := jsonb_set(r, '{datos_modelo_restaurados}', to_jsonb((r ->> 'datos_modelo_restaurados')::int + 1)); end if;
    elsif c.accion = 'alta_proveedor' then
      delete from public.proveedores p where p.id = c.proveedor_id and not exists (select 1 from public.modelos m where m.proveedor_id = p.id);
      if found then r := jsonb_set(r, '{proveedores_borrados}', to_jsonb((r ->> 'proveedores_borrados')::int + 1)); end if;
    end if;
  end loop;
  update public.importaciones set revertida_en = now(), resumen = resumen || jsonb_build_object('reversion', r) where id = p_importacion_id;
  return r;
end;
$$;

-- The generic revert (history, Firestore catalogue) must not handle price-list imports
create or replace function public.revertir_importacion(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.importaciones where id = p_id and tipo = 'tarifa_proveedor') then
    raise exception 'Use revertir_tarifa for supplier price-list imports' using errcode = '22023';
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

-- Catalogue views: same columns as before plus the brand at the end
create or replace view public.v_catalogo_plano with (security_invoker = true) as
  select v.id, m.tipo, coalesce(p.nombre, 'Productos propios') as proveedor, m.nombre as modelo, v.talla, v.color, v.coste_cent,
    v.precio_neto, v.iva_porcentaje,
    case
      when v.precio_neto is not null then v.precio_neto * (100 + v.iva_porcentaje) / 100.0
      when v.precio_compra is not null then v.precio_compra
      else v.coste_cent / 100.0
    end as coste,
    m.referencia,
    (m.proveedor_id is null) as propio,
    m.marca
  from public.variantes v
  join public.modelos m on m.id = v.modelo_id
  left join public.proveedores p on p.id = m.proveedor_id
  where v.activo and m.activo and (p.id is null or p.activo);

create or replace view public.v_catalogo_admin with (security_invoker = true) as
  select v.id as variante_id, m.id as modelo_id, p.id as proveedor_id,
    p.nombre as proveedor, (m.proveedor_id is null) as propio,
    m.tipo, m.nombre as modelo, m.referencia, v.color, v.talla,
    v.precio_neto, v.iva_porcentaje, v.precio_compra, v.coste_cent,
    case
      when v.precio_neto is not null then v.precio_neto * (100 + v.iva_porcentaje) / 100.0
      when v.precio_compra is not null then v.precio_compra
      else v.coste_cent / 100.0
    end as coste,
    v.activo as variante_activa, m.activo as modelo_activo, coalesce(p.activo, true) as proveedor_activo,
    (v.activo and m.activo and coalesce(p.activo, true)) as disponible,
    m.marca
  from public.variantes v
  join public.modelos m on m.id = v.modelo_id
  left join public.proveedores p on p.id = m.proveedor_id;

alter table public.variantes_tarifas enable row level security;
alter table public.importaciones_cambios enable row level security;
drop policy if exists variantes_tarifas_propietario on public.variantes_tarifas;
drop policy if exists importaciones_cambios_lectura on public.importaciones_cambios;
create policy variantes_tarifas_propietario on public.variantes_tarifas for all to authenticated using (public.es_propietario()) with check (public.es_propietario());
create policy importaciones_cambios_lectura on public.importaciones_cambios for select to authenticated using (public.es_propietario());

revoke all on public.variantes_tarifas, public.importaciones_cambios from anon;
grant select, insert, update, delete on public.variantes_tarifas to authenticated;
grant select on public.importaciones_cambios to authenticated;
grant select on public.variantes_tarifas, public.importaciones_cambios to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
-- the log is written by importar_tarifa / revertir_tarifa (security invoker), so the owner needs insert
grant insert on public.importaciones_cambios to authenticated;
drop policy if exists importaciones_cambios_alta on public.importaciones_cambios;
create policy importaciones_cambios_alta on public.importaciones_cambios for insert to authenticated with check (public.es_propietario());

revoke execute on function public.importar_tarifa(jsonb, jsonb, uuid, integer, integer) from anon, public;
revoke execute on function public.revertir_tarifa(bigint) from anon, public;
revoke execute on function public.guardar_tarifas_variante(bigint, jsonb, bigint) from anon, public;
revoke execute on function public.restaurar_tarifas_variante(bigint, jsonb) from anon, public;
revoke execute on function public.precio_variante_json(public.variantes) from anon, public;
revoke execute on function public.completar_datos_modelo(bigint, bigint, text, text) from anon, public;
grant execute on function public.completar_datos_modelo(bigint, bigint, text, text) to authenticated;
revoke execute on function public.tarifas_variante_json(bigint) from anon, public;
grant execute on function public.importar_tarifa(jsonb, jsonb, uuid, integer, integer) to authenticated;
grant execute on function public.revertir_tarifa(bigint) to authenticated;
grant execute on function public.guardar_tarifas_variante(bigint, jsonb, bigint) to authenticated;
grant execute on function public.restaurar_tarifas_variante(bigint, jsonb) to authenticated;
grant execute on function public.precio_variante_json(public.variantes) to authenticated;
grant execute on function public.tarifas_variante_json(bigint) to authenticated;
grant update (revertida_en, resumen, proveedor_id) on public.importaciones to authenticated;
grant update (modalidad_tarifa) on public.proveedores to authenticated;
