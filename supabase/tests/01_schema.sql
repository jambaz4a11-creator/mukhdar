-- 01: المخطط، RLS، الصلاحيات، والدوال الأساسية
select plan(24);

select tables_are('public', array[
  'cities', 'vendors', 'profiles', 'app_settings', 'sectors', 'subsections', 'buildings', 'addresses',
  'categories', 'products', 'product_costs', 'stock', 'inventory_movements', 'orders', 'order_items',
  'order_item_costs', 'order_status_history', 'ratings', 'push_tokens', 'notification_outbox', 'daily_stats'
], 'public has exactly the expected tables');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is enabled on every public table');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'notification_outbox'),
  0, 'notification_outbox has no policies (service_role only)');

-- كل الدوال (عدا دوال الامتدادات) لها search_path ثابت
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  0, 'every public/private function has a fixed search_path');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon cannot execute any SECURITY DEFINER function in public');

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')),
  array['accept_order', 'adjust_stock', 'assign_driver', 'available_orders', 'place_order', 'rate_order',
        'register_push_token', 'set_order_status', 'set_user_role'],
  'authenticated can execute exactly the 9 RPCs among SECURITY DEFINER functions');

select ok(not has_function_privilege('authenticated', 'public._notify(text, uuid, text, text, jsonb)', 'execute'),
  'internal _notify is not callable by authenticated');
select ok(not has_function_privilege('authenticated',
  'public._bump_daily_stats(date, int, int, bigint, bigint, bigint)', 'execute'),
  'internal _bump_daily_stats is not callable by authenticated');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and table_name in ('orders', 'order_items', 'order_item_costs', 'order_status_history', 'stock',
                         'inventory_movements', 'ratings', 'daily_stats', 'notification_outbox')),
  0, 'no direct write grants on orders/stock/ledger tables');

select ok(not has_table_privilege('authenticated', 'public.notification_outbox', 'select'),
  'authenticated cannot read notification_outbox');
select ok(not has_table_privilege('anon', 'public.orders', 'select'), 'anon has no grant on orders');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'update'),
  'authenticated cannot update profiles.role');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'is_active', 'update'),
  'authenticated cannot update profiles.is_active');
select ok(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'update'),
  'authenticated can update profiles.full_name');

-- السياسات تستخدم (select auth.uid()) و (select private.*) لا الاستدعاء لكل صف
select is(
  (select count(*)::int from pg_policies
    where schemaname in ('public', 'storage')
      and replace(replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                          'SELECT auth.uid()', ''), 'SELECT private.', '')
          ~ '(auth\.uid\(\)|private\.|public\.is_|public\.current_user_role)'),
  0, 'every policy wraps auth.uid()/role helpers in a sub-select');

-- التقريب لأقرب 250 (النصف للأعلى)
select is(public.round_iqd(0), 0::bigint, 'round_iqd(0) = 0');
select is(public.round_iqd(124), 0::bigint, 'round_iqd(124) = 0');
select is(public.round_iqd(125), 250::bigint, 'round_iqd(125) = 250 (half up)');
select is(public.round_iqd(374), 250::bigint, 'round_iqd(374) = 250');
select is(public.round_iqd(1375), 1500::bigint, 'round_iqd(1375) = 1500');

-- تسجيل مستخدم جديد ينشئ profile بدور customer
select lives_ok($$ insert into auth.users (id, phone, aud, role)
                   values ('00000000-0000-0000-0000-0000000000a1', '9647911111111', 'authenticated', 'authenticated') $$,
  'insert auth user');
select row_eq($$ select role, phone, is_active from public.profiles where id = '00000000-0000-0000-0000-0000000000a1' $$,
  row('customer'::public.user_role, '9647911111111'::text, true),
  'new auth user gets an active customer profile with the phone');

-- منتج جديد: صف مخزون بصفر، وغير متوفر
select tests.remember('p_new', tests.new_product(500, 0));
select is((select qty from public.stock where product_id = tests.id('p_new')), 0,
  'new product gets a stock row with qty 0');
select is((select in_stock from public.products where id = tests.id('p_new')), false,
  'product without stock is in_stock = false');

select * from finish();
