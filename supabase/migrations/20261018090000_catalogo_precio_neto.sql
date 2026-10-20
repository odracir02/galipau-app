-- Catalogue prices exactly as the supplier lists them: net price + VAT rate.
-- The master spreadsheet stores "real cost = net x (1 + VAT)": net prices have
-- up to three decimals and the resulting cost up to five (e.g. 2.125 x 1.21 =
-- 2.57125). Rounding that to cents would change quote costs, so the net price
-- (up to four decimals) and the VAT rate are kept and the exact cost is
-- derived from them. coste_cent stays as the rounded value for listings and
-- for variants that only have a cost (e.g. imported from Firestore).
--
-- Safety: this migration only ADDS two nullable columns and one check to
-- variantes, and REPLACES the definition of the v_catalogo_plano view and of
-- the importar_catalogo function (same names, same signature, privileges kept
-- and restated). It deletes no table, column or row and updates no data;
-- existing variants keep their cost (new columns stay empty). It can be run
-- more than once.

alter table public.variantes
  add column if not exists precio_neto numeric(12, 4) check (precio_neto is null or precio_neto >= 0),
  add column if not exists iva_porcentaje numeric(5, 2) check (iva_porcentaje is null or (iva_porcentaje >= 0 and iva_porcentaje <= 100));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'variantes_neto_iva_check' and conrelid = 'public.variantes'::regclass) then
    alter table public.variantes
      add constraint variantes_neto_iva_check check ((precio_neto is null) = (iva_porcentaje is null));
  end if;
end;
$$;

-- Exact cost in euros: net × (1 + VAT) when known, otherwise the stored cost
create or replace view public.v_catalogo_plano with (security_invoker = true) as
  select v.id, m.tipo, p.nombre as proveedor, m.nombre as modelo, v.talla, v.color, v.coste_cent,
    v.precio_neto, v.iva_porcentaje,
    case when v.precio_neto is not null
      then v.precio_neto * (100 + v.iva_porcentaje) / 100.0
      else v.coste_cent / 100.0 end as coste,
    m.referencia
  from public.variantes v
  join public.modelos m on m.id = v.modelo_id
  join public.proveedores p on p.id = m.proveedor_id
  where v.activo and m.activo and p.activo;

-- Import: rows may carry precio_neto (euros) + iva_porcentaje (cost derived) or only
-- coste_cent. Models are matched by supplier and name (ignoring case), so the
-- same model is never created twice even if its garment type is written
-- differently. Existing suppliers, models and variants are never modified.
create or replace function public.importar_catalogo(p_filas jsonb, p_resumen jsonb default '{}'::jsonb)
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
  v_neto numeric(12, 4);
  v_iva numeric(5, 2);
  v_coste integer;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'Nothing to import' using errcode = '22023';
  end if;
  insert into public.importaciones (tipo, resumen) values ('catalogo_firestore', coalesce(p_resumen, '{}'::jsonb)) returning id into v_id;
  for r in select * from jsonb_array_elements(p_filas) loop
    v_neto := (r ->> 'precio_neto')::numeric;
    v_iva := (r ->> 'iva_porcentaje')::numeric;
    v_coste := case when v_neto is not null then round(v_neto * (100 + v_iva))::integer else (r ->> 'coste_cent')::integer end;
    select id into v_proveedor from public.proveedores where lower(nombre) = lower(r ->> 'proveedor');
    if v_proveedor is null then
      insert into public.proveedores (nombre, importacion_id) values (r ->> 'proveedor', v_id) returning id into v_proveedor;
    end if;
    select id into v_modelo from public.modelos
      where proveedor_id = v_proveedor and lower(nombre) = lower(r ->> 'modelo') order by id limit 1;
    if v_modelo is null then
      insert into public.modelos (proveedor_id, tipo, nombre, referencia, importacion_id)
      values (v_proveedor, r ->> 'tipo', r ->> 'modelo', nullif(r ->> 'referencia', ''), v_id) returning id into v_modelo;
    end if;
    if not exists (select 1 from public.variantes
                   where modelo_id = v_modelo and lower(color) = lower(r ->> 'color') and lower(talla) = lower(r ->> 'talla')) then
      insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje, importacion_id)
      values (v_modelo, r ->> 'color', r ->> 'talla', v_coste, v_neto, v_iva, v_id);
    end if;
  end loop;
  return v_id;
end;
$$;

revoke execute on function public.importar_catalogo(jsonb, jsonb) from anon, public;
grant execute on function public.importar_catalogo(jsonb, jsonb) to authenticated;
grant select on public.v_catalogo_plano to authenticated;
