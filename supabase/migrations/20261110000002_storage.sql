-- صور المنتجات والأقسام: قراءة عامة، رفع/تعديل/حذف للأدمن فقط.
-- الصور تُصغَّر بالتطبيق قبل الرفع (أقصى عرض 800px، WebP/JPEG، أقل من 200KB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 524288, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

create policy product_images_read on storage.objects for select
  using (bucket_id = 'product-images');

create policy product_images_admin_insert on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_admin());

create policy product_images_admin_update on storage.objects for update
  using (bucket_id = 'product-images' and public.is_admin());

create policy product_images_admin_delete on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_admin());
