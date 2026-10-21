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
--
-- Safety: adds tables, columns and functions; widens one check. No data is
-- deleted or updated. Re-runnable.

alter table public.modelos add column if not exists marca text;
alter table public.proveedores add column if not exists modalidad_tarifa text;

alter table public.importaciones add column if not exists usuario uuid default auth.uid();
alter table public.importaciones add column if not exists proveedor_id bigint references public.proveedores on delete restrict;
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
  accion text not null check (accion in ('alta_proveedor', 'alta_modelo', 'alta_variante', 'precio', 'archivar', 'tarifas', 'referencia')),
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
  select jsonb_build_object('precio_neto', v.precio_neto, 'iva_porcentaje', v.iva_porcentaje, 'precio_compra', v.precio_compra, 'coste_cent', v.coste_cent);
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

/*
 * p_meta: { proveedor_id?, proveedor_nombre?, modalidad, interpretacion, archivo: { nombre, sha256, formato }, resumen }
 * p_operaciones: [
 *   { accion: 'alta', modelo: { nombre, referencia, tipo, marca, descripcion }, color, talla, precio: { precio_neto, iva_porcentaje, precio_compra }, coste_cent, tarifas: [...] },
 *   { accion: 'precio', variante_id, precio: {...}, coste_cent, tarifas: [...] },
 *   { accion: 'tarifas', variante_id, tarifas: [...] },
 *   { accion: 'archivar', variante_id }
 * ]
 * Only the operations the owner accepted in the preview are sent.
 */
create or replace function public.importar_tarifa(p_meta jsonb, p_operaciones jsonb)
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
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_operaciones) <> 'array' or jsonb_array_length(p_operaciones) = 0 then
    raise exception 'Nothing to import' using errcode = '22023';
  end if;
  insert into public.importaciones (tipo, resumen) values ('tarifa_proveedor', coalesce(p_meta, '{}'::jsonb) - 'proveedor_id') returning id into v_imp;

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

  for op in select * from jsonb_array_elements(p_operaciones) loop
    if op ->> 'accion' = 'alta' then
      -- Model: same reference first, then same name (ignoring case); created if missing
      select id into v_mod from public.modelos
        where proveedor_id = v_prov
          and ((nullif(op -> 'modelo' ->> 'referencia', '') is not null and referencia = op -> 'modelo' ->> 'referencia')
               or lower(nombre) = lower(op -> 'modelo' ->> 'nombre'))
        order by (referencia = op -> 'modelo' ->> 'referencia') desc nulls last, id
        limit 1;
      if v_mod is null then
        insert into public.modelos (proveedor_id, tipo, nombre, referencia, marca, descripcion, importacion_id)
        values (v_prov, op -> 'modelo' ->> 'tipo', op -> 'modelo' ->> 'nombre', nullif(op -> 'modelo' ->> 'referencia', ''),
                nullif(op -> 'modelo' ->> 'marca', ''), nullif(op -> 'modelo' ->> 'descripcion', ''), v_imp)
        returning id into v_mod;
        insert into public.importaciones_cambios (importacion_id, accion, proveedor_id, modelo_id) values (v_imp, 'alta_modelo', v_prov, v_mod);
      elsif nullif(op -> 'modelo' ->> 'referencia', '') is not null
            and (select referencia from public.modelos where id = v_mod) is null then
        -- Fill a missing manufacturer reference (nothing else of an existing model changes)
        update public.modelos set referencia = op -> 'modelo' ->> 'referencia' where id = v_mod;
        insert into public.importaciones_cambios (importacion_id, accion, modelo_id, antes, despues)
        values (v_imp, 'referencia', v_mod, jsonb_build_object('referencia', null), jsonb_build_object('referencia', op -> 'modelo' ->> 'referencia'));
      end if;
      insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje, precio_compra, importacion_id)
      values (v_mod, op ->> 'color', op ->> 'talla', coalesce((op ->> 'coste_cent')::integer, 0),
              (op -> 'precio' ->> 'precio_neto')::numeric, (op -> 'precio' ->> 'iva_porcentaje')::numeric, (op -> 'precio' ->> 'precio_compra')::numeric, v_imp)
      returning id into v_id;
      perform public.guardar_tarifas_variante(v_id, op -> 'tarifas', v_imp);
      insert into public.importaciones_cambios (importacion_id, accion, modelo_id, variante_id, despues)
      values (v_imp, 'alta_variante', v_mod, v_id, public.tarifas_variante_json(v_id));

    elsif op ->> 'accion' = 'precio' then
      select * into v_var from public.variantes where id = (op ->> 'variante_id')::bigint for update;
      if not found then
        raise exception 'Variant % not found', op ->> 'variante_id' using errcode = 'P0002';
      end if;
      v_antes := public.precio_variante_json(v_var) || jsonb_build_object('tarifas', public.tarifas_variante_json(v_var.id));
      update public.variantes
        set precio_neto = (op -> 'precio' ->> 'precio_neto')::numeric, iva_porcentaje = (op -> 'precio' ->> 'iva_porcentaje')::numeric,
            precio_compra = (op -> 'precio' ->> 'precio_compra')::numeric, coste_cent = coalesce((op ->> 'coste_cent')::integer, coste_cent)
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
 *   variantes_borradas, variantes_archivadas (in use), modelos_borrados, ... }
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
  r jsonb := jsonb_build_object('precios_restaurados', 0, 'precios_conservados', 0, 'variantes_borradas', 0, 'variantes_archivadas', 0,
                                'reactivadas', 0, 'tarifas_restauradas', 0, 'modelos_borrados', 0, 'proveedores_borrados', 0, 'referencias_restauradas', 0);
  en_uso boolean;
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
              precio_compra = (c.antes ->> 'precio_compra')::numeric, coste_cent = (c.antes ->> 'coste_cent')::integer
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
      en_uso := exists (select 1 from public.stock_articulos s where s.variante_id = c.variante_id)
        or exists (select 1 from public.presupuestos p, jsonb_array_elements(coalesce(p.entrada -> 'formulario' -> 'lineas', '[]'::jsonb)) l
                   where l ->> 'productoId' = c.variante_id::text);
      if en_uso then
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
    elsif c.accion = 'referencia' then
      update public.modelos set referencia = null where id = c.modelo_id and referencia = c.despues ->> 'referencia';
      if found then r := jsonb_set(r, '{referencias_restauradas}', to_jsonb((r ->> 'referencias_restauradas')::int + 1)); end if;
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

revoke execute on function public.importar_tarifa(jsonb, jsonb) from anon, public;
revoke execute on function public.revertir_tarifa(bigint) from anon, public;
revoke execute on function public.guardar_tarifas_variante(bigint, jsonb, bigint) from anon, public;
revoke execute on function public.restaurar_tarifas_variante(bigint, jsonb) from anon, public;
revoke execute on function public.precio_variante_json(public.variantes) from anon, public;
revoke execute on function public.tarifas_variante_json(bigint) from anon, public;
grant execute on function public.importar_tarifa(jsonb, jsonb) to authenticated;
grant execute on function public.revertir_tarifa(bigint) to authenticated;
grant execute on function public.guardar_tarifas_variante(bigint, jsonb, bigint) to authenticated;
grant execute on function public.restaurar_tarifas_variante(bigint, jsonb) to authenticated;
grant execute on function public.precio_variante_json(public.variantes) to authenticated;
grant execute on function public.tarifas_variante_json(bigint) to authenticated;
grant update (revertida_en, resumen, proveedor_id) on public.importaciones to authenticated;
grant update (modalidad_tarifa) on public.proveedores to authenticated;
