-- FICTITIOUS sample data for the TEST Supabase project only.
-- Never run this on the production project.
-- Run it from the SQL editor (it bypasses RLS) after applying the migrations.

do $$
begin
  if exists (select 1 from public.configuracion where clave = 'entorno' and valor = '"produccion"'::jsonb) then
    raise exception 'This database is marked as production: sample data refused.';
  end if;
end $$;

insert into public.configuracion (clave, valor) values ('entorno', '"pruebas"')
on conflict (clave) do nothing;

insert into public.proveedores (nombre) values ('Proveedor Demo A'), ('Proveedor Demo B')
on conflict (nombre) do nothing;

insert into public.modelos (proveedor_id, tipo, nombre)
select p.id, m.tipo, m.nombre
from (values
  ('Proveedor Demo A', 'Camiseta', 'Básica 150'),
  ('Proveedor Demo B', 'Camiseta', 'Premium 190'),
  ('Proveedor Demo A', 'Sudadera', 'Capucha 280'),
  ('Proveedor Demo B', 'Polo', 'Piqué 210')
) as m (proveedor, tipo, nombre)
join public.proveedores p on p.nombre = m.proveedor
on conflict (proveedor_id, tipo, nombre) do nothing;

insert into public.variantes (modelo_id, color, talla, coste_cent)
select mo.id, c.color, t.talla, c.coste_cent
from (values
  ('Básica 150', 'Blanco', 195), ('Básica 150', 'Negro', 235), ('Básica 150', 'Rojo', 235),
  ('Premium 190', 'Blanco', 310), ('Premium 190', 'Azul', 360),
  ('Capucha 280', 'Blanco', 980), ('Capucha 280', 'Gris', 1040),
  ('Piqué 210', 'Blanco', 520), ('Piqué 210', 'Verde', 570)
) as c (modelo, color, coste_cent)
join public.modelos mo on mo.nombre = c.modelo
cross join (values ('S'), ('M'), ('L'), ('XL')) as t (talla)
on conflict (modelo_id, color, talla) do nothing;

insert into public.clientes (tipo, nombre, nif, email, ciudad)
values
  ('asociacion', 'Club Deportivo Ficticio', 'G00000001', 'club@example.com', 'Valencia'),
  ('empresa', 'Taller Imaginario SL', 'B00000002', 'taller@example.com', 'Madrid')
on conflict (nif) do nothing;
