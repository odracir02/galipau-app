-- Catalogue management from the app: suppliers, models (also the workshop's
-- own products, without a supplier) and colour/size variants with their
-- purchase price. The catalogue lists what can be bought; it holds no stock.
--
-- Safety: this migration only adds nullable columns, indexes, a trigger and
-- two views, relaxes "model needs a supplier" to allow own products, and
-- replaces the price check with a wider one. It deletes no table, column or
-- row and updates no data: existing variants keep their prices and cost.
-- It can be run more than once.

-- Suppliers: optional contact details and our customer reference with them
alter table public.proveedores
  add column if not exists contacto text,
  add column if not exists referencia_cliente text;

-- Own products: models without a supplier
alter table public.modelos alter column proveedor_id drop not null;
create unique index if not exists modelos_nombre_por_proveedor on public.modelos (proveedor_id, lower(nombre)) where proveedor_id is not null;
create unique index if not exists modelos_propios_nombre on public.modelos (lower(tipo), lower(nombre)) where proveedor_id is null;

-- Prices: either net price + VAT rate, or a purchase price that already
-- includes VAT (precio_compra; iva_porcentaje then only says which VAT it
-- includes). Never both, so VAT cannot be added twice.
alter table public.variantes add column if not exists precio_compra numeric(12, 4) check (precio_compra is null or precio_compra >= 0);
alter table public.variantes drop constraint if exists variantes_neto_iva_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'variantes_precio_check' and conrelid = 'public.variantes'::regclass) then
    alter table public.variantes add constraint variantes_precio_check check (
      (precio_neto is null or iva_porcentaje is not null) and not (precio_neto is not null and precio_compra is not null)
    );
  end if;
end;
$$;

-- No repeated colour + size in a model, whatever the capitalisation
create unique index if not exists variantes_modelo_color_talla_ci on public.variantes (modelo_id, lower(color), lower(talla));

-- coste_cent always follows the exact price (rounded only for listings)
create or replace function public.calcular_coste_variante()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.precio_neto is not null and new.iva_porcentaje is not null then
    new.coste_cent := round(new.precio_neto * (100 + new.iva_porcentaje))::integer;
  elsif new.precio_compra is not null then
    new.coste_cent := round(new.precio_compra * 100)::integer;
  end if;
  return new;
end;
$$;
drop trigger if exists variantes_coste on public.variantes;
create trigger variantes_coste before insert or update on public.variantes
  for each row execute function public.calcular_coste_variante();

-- Catalogue used by the calculator and quotes: active items only, own products included
create or replace view public.v_catalogo_plano with (security_invoker = true) as
  select v.id, m.tipo, coalesce(p.nombre, 'Productos propios') as proveedor, m.nombre as modelo, v.talla, v.color, v.coste_cent,
    v.precio_neto, v.iva_porcentaje,
    case
      when v.precio_neto is not null then v.precio_neto * (100 + v.iva_porcentaje) / 100.0
      when v.precio_compra is not null then v.precio_compra
      else v.coste_cent / 100.0
    end as coste,
    m.referencia,
    (m.proveedor_id is null) as propio
  from public.variantes v
  join public.modelos m on m.id = v.modelo_id
  left join public.proveedores p on p.id = m.proveedor_id
  where v.activo and m.activo and (p.id is null or p.activo);

-- Administration: every variant, archived ones included, with ids and price details
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
    (v.activo and m.activo and coalesce(p.activo, true)) as disponible
  from public.variantes v
  join public.modelos m on m.id = v.modelo_id
  left join public.proveedores p on p.id = m.proveedor_id;

grant select on public.v_catalogo_plano, public.v_catalogo_admin to authenticated;
grant select on public.v_catalogo_admin to service_role;
revoke all on public.v_catalogo_admin from anon;
revoke execute on function public.calcular_coste_variante() from anon, public;
