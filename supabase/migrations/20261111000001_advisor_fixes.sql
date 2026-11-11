-- =====================================================================
-- إصلاح تحذيرات Security/Performance Advisor (T03)
--   1) search_path ثابت للدوال الثلاث (function_search_path_mutable)
--   2) دوال الأدوار security definer تنتقل لمخطط private غير مكشوف بالـ API
--      (anon/authenticated_security_definer_function_executable)
--   3) سياسات RLS تستخدم (select ...) لتُحسب مرة واحدة بالاستعلام (auth_rls_initplan)
--   4) لا سياستان permissive لنفس الدور والعملية (multiple_permissive_policies):
--      سياسات الأدمن "for all" تنقسم إلى insert/update/delete، والقراءة بسياسة واحدة.
-- السلوك (من يرى ماذا ومن يكتب ماذا) لا يتغير. الاختبارات بـ supabase/tests.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) search_path ثابت
-- ---------------------------------------------------------------------
alter function public.set_updated_at()   set search_path = '';
alter function public.round_iqd(bigint)  set search_path = '';
alter function public.baghdad_today()    set search_path = '';

-- ---------------------------------------------------------------------
-- 2) دوال الأدوار: التنفيذ الفعلي بمخطط private (غير مكشوف عبر PostgREST)
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.current_user_role()
returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_user_role() = 'admin', false)
$$;

create or replace function private.is_staff_or_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_user_role() in ('staff', 'admin'), false)
$$;

revoke all on function private.current_user_role(), private.is_admin(), private.is_staff_or_admin()
  from public;
grant execute on function private.current_user_role(), private.is_admin(), private.is_staff_or_admin()
  to anon, authenticated;

-- الأسماء القديمة بـ public تبقى (تستخدمها دوال RPC) لكن security invoker،
-- فلا تُعتبر نقطة دخول security definer عبر /rest/v1/rpc.
create or replace function public.current_user_role()
returns public.user_role
language sql stable security invoker set search_path = '' as $$
  select private.current_user_role()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_admin()
$$;

create or replace function public.is_staff_or_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_staff_or_admin()
$$;

-- ---------------------------------------------------------------------
-- 3+4) إعادة كتابة السياسات
-- ---------------------------------------------------------------------
-- الكتالوج والعناوين: قراءة واحدة (النشط للجميع + الإدارة)، وكتابة للأدمن فقط
drop policy cities_read       on public.cities;
drop policy cities_admin      on public.cities;
drop policy vendors_read      on public.vendors;
drop policy vendors_admin     on public.vendors;
drop policy sectors_read      on public.sectors;
drop policy sectors_admin     on public.sectors;
drop policy subsections_read  on public.subsections;
drop policy subsections_admin on public.subsections;
drop policy buildings_read    on public.buildings;
drop policy buildings_admin   on public.buildings;
drop policy categories_read   on public.categories;
drop policy categories_admin  on public.categories;
drop policy products_read     on public.products;
drop policy products_admin    on public.products;

create policy cities_read        on public.cities      for select using (is_active or (select private.is_admin()));
create policy cities_insert      on public.cities      for insert to authenticated with check ((select private.is_admin()));
create policy cities_update      on public.cities      for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy cities_delete      on public.cities      for delete to authenticated using ((select private.is_admin()));

create policy vendors_read       on public.vendors     for select using (is_active or (select private.is_admin()));
create policy vendors_insert     on public.vendors     for insert to authenticated with check ((select private.is_admin()));
create policy vendors_update     on public.vendors     for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy vendors_delete     on public.vendors     for delete to authenticated using ((select private.is_admin()));

create policy sectors_read       on public.sectors     for select using (is_active or (select private.is_admin()));
create policy sectors_insert     on public.sectors     for insert to authenticated with check ((select private.is_admin()));
create policy sectors_update     on public.sectors     for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sectors_delete     on public.sectors     for delete to authenticated using ((select private.is_admin()));

create policy subsections_read   on public.subsections for select using (is_active or (select private.is_admin()));
create policy subsections_insert on public.subsections for insert to authenticated with check ((select private.is_admin()));
create policy subsections_update on public.subsections for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy subsections_delete on public.subsections for delete to authenticated using ((select private.is_admin()));

create policy buildings_read     on public.buildings   for select using (is_active or (select private.is_admin()));
create policy buildings_insert   on public.buildings   for insert to authenticated with check ((select private.is_admin()));
create policy buildings_update   on public.buildings   for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy buildings_delete   on public.buildings   for delete to authenticated using ((select private.is_admin()));

create policy categories_read    on public.categories  for select using (is_active or (select private.is_staff_or_admin()));
create policy categories_insert  on public.categories  for insert to authenticated with check ((select private.is_admin()));
create policy categories_update  on public.categories  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy categories_delete  on public.categories  for delete to authenticated using ((select private.is_admin()));

create policy products_read      on public.products    for select using (is_active or (select private.is_staff_or_admin()));
create policy products_insert    on public.products    for insert to authenticated with check ((select private.is_admin()));
create policy products_update    on public.products    for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy products_delete    on public.products    for delete to authenticated using ((select private.is_admin()));

-- الإعدادات
drop policy settings_admin on public.app_settings;
create policy settings_admin on public.app_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- بيانات الأدمن/الموظف فقط
drop policy product_costs_admin    on public.product_costs;
drop policy stock_read_staff       on public.stock;
drop policy movements_read_admin   on public.inventory_movements;
drop policy item_costs_read_admin  on public.order_item_costs;
drop policy daily_stats_read_admin on public.daily_stats;

create policy product_costs_admin    on public.product_costs       for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy stock_read_staff       on public.stock               for select to authenticated using ((select private.is_staff_or_admin()));
create policy movements_read_admin   on public.inventory_movements for select to authenticated using ((select private.is_admin()));
create policy item_costs_read_admin  on public.order_item_costs    for select to authenticated using ((select private.is_admin()));
create policy daily_stats_read_admin on public.daily_stats         for select to authenticated using ((select private.is_admin()));

-- الملف الشخصي
drop policy profiles_read_own   on public.profiles;
drop policy profiles_update_own on public.profiles;
create policy profiles_read_own   on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- عناوين الزبون: قراءة واحدة (صاحبها أو الأدمن)، والكتابة لصاحبها
drop policy addresses_own        on public.addresses;
drop policy addresses_read_admin on public.addresses;
create policy addresses_read   on public.addresses for select to authenticated
  using (customer_id = (select auth.uid()) or (select private.is_admin()));
create policy addresses_insert on public.addresses for insert to authenticated
  with check (customer_id = (select auth.uid()));
create policy addresses_update on public.addresses for update to authenticated
  using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));
create policy addresses_delete on public.addresses for delete to authenticated
  using (customer_id = (select auth.uid()));

-- الطلبات: قراءة فقط. الكتابة عبر الدوال.
drop policy orders_read        on public.orders;
drop policy order_items_read   on public.order_items;
drop policy order_history_read on public.order_status_history;
drop policy ratings_read       on public.ratings;
create policy orders_read on public.orders for select to authenticated using (
  customer_id = (select auth.uid()) or driver_id = (select auth.uid()) or (select private.is_staff_or_admin()));
create policy order_items_read on public.order_items for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id));      -- يرث RLS الطلبات
create policy order_history_read on public.order_status_history for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id));
create policy ratings_read on public.ratings for select to authenticated using (
  customer_id = (select auth.uid()) or (select private.is_staff_or_admin()));

drop policy push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- صور المنتجات (storage)
drop policy product_images_admin_insert on storage.objects;
drop policy product_images_admin_update on storage.objects;
drop policy product_images_admin_delete on storage.objects;
create policy product_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select private.is_admin()));
create policy product_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));
create policy product_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));
