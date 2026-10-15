-- Private Storage bucket for customer logos and design files (owner only).
-- A per-file size limit protects the 1 GB Free plan storage quota.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'archivos',
  'archivos',
  false,
  10485760, -- 10 MiB
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf']
)
on conflict (id) do nothing;

create policy archivos_propietario_lectura on storage.objects
  for select to authenticated using (bucket_id = 'archivos' and public.es_propietario());
create policy archivos_propietario_alta on storage.objects
  for insert to authenticated with check (bucket_id = 'archivos' and public.es_propietario());
create policy archivos_propietario_cambio on storage.objects
  for update to authenticated
  using (bucket_id = 'archivos' and public.es_propietario())
  with check (bucket_id = 'archivos' and public.es_propietario());
create policy archivos_propietario_baja on storage.objects
  for delete to authenticated using (bucket_id = 'archivos' and public.es_propietario());
