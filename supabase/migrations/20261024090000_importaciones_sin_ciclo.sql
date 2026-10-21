-- Removes the foreign key importaciones.proveedor_id -> proveedores (added in
-- 20261023090000). proveedores.importacion_id already points the other way, and
-- the two together form a cycle: a data-only dump (the daily backup) cannot be
-- restored in any table order, so the backup verification failed.
-- The column stays as information about which supplier a price-list import
-- belongs to. Safety: drops one constraint; no data changes. Re-runnable.

alter table public.importaciones drop constraint if exists importaciones_proveedor_id_fkey;
