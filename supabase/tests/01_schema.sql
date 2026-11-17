-- 01: المخطط، RLS، الصلاحيات، والدوال الأساسية
select plan(41);

select tables_are('public', array[
  'cities', 'vendors', 'profiles', 'app_settings', 'sectors', 'subsections', 'buildings', 'addresses',
  'categories', 'products', 'product_costs', 'stock', 'inventory_movements', 'orders', 'order_items',
  'order_item_costs', 'order_status_history', 'ratings', 'push_tokens', 'notification_outbox', 'daily_stats',
  'pin_resets', 'user_creations', 'admin_audit', 'admin_function_hits'
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
  array['accept_order', 'add_buildings', 'address_usage', 'adjust_stock', 'adjust_stock_bulk', 'admin_cancel_customer_orders', 'admin_reset_mfa',
        'admin_save_product', 'assign_driver', 'available_orders', 'dashboard_today', 'dismiss_failed_notifications', 'failed_notifications_count',
        'list_drivers', 'place_order', 'rate_order', 'ratings_list', 'ratings_summary', 'recompute_daily_stats',
        'register_push_token',
        'reorder_products', 'report_daily', 'report_drivers', 'report_orders_placed', 'report_summary',
        'report_top_products', 'report_waste', 'set_order_status', 'set_product_price', 'set_user_role',
        'stuck_notifications_count', 'touch_panel_session', 'update_app_settings'],
  'authenticated can execute exactly the 33 RPCs among SECURITY DEFINER functions (T23: admin_reset_mfa, admin_cancel_customer_orders, touch_panel_session)');

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

-- service_role (Edge Functions): بالضبط ما تحتاجه T07/T08، بنفس الشكل محلياً وبالسحابة
select ok(has_schema_privilege('service_role', 'public', 'usage'), 'service_role has usage on schema public');
select is(
  (select array_agg(c.relname || ':' || p.priv order by c.relname, p.priv)
     from pg_class c cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and has_table_privilege('service_role', c.oid, p.priv)),
  array['notification_outbox:SELECT', 'notification_outbox:UPDATE', 'orders:SELECT', 'profiles:SELECT',
        'push_tokens:DELETE', 'push_tokens:SELECT'],
  'service_role has exactly the table privileges T07/T08 need (T19 audit tables: functions only)');


-- service_role: الدوال الخاصة به بالضبط (Edge Functions)، لا أكثر (مراجعة T16-T19 L6). Supabase المحلي يمنح
-- service_role تنفيذ الدوال الداخلية افتراضياً (السحابة لا): نستثني دوال الـ trigger وما يبدأ بـ "_" فقط.
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.prorettype <> 'trigger'::regtype and left(p.proname::text, 1) <> '_'
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')),
  array['abort_account_deletion', 'admin_rate_hit', 'begin_account_deletion', 'break_glass_reset_mfa',
        'finish_user_creation', 'push_dispatch_authorized', 'record_pin_reset', 'revoke_user_sessions',
        'signup_rate_hit'],
  'service_role-only SECURITY DEFINER functions (T07 push, T08 deletion, signup, T19/B PIN reset, account creation, rate limit)');

-- الدوال الجديدة لا تُنفَّذ افتراضياً (default privileges عامة، لا بالمخطط فقط)
create function public.zz_default_acl_probe() returns int language sql set search_path = '' as 'select 1';
select ok(not has_function_privilege('anon', 'public.zz_default_acl_probe()', 'execute'),
  'a new function is not executable by anon by default');
select ok(not has_function_privilege('authenticated', 'public.zz_default_acl_probe()', 'execute'),
  'a new function is not executable by authenticated by default');
drop function public.zz_default_acl_probe();

-- sequences: لا حاجة لها (أعمدة identity)
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
      and (has_sequence_privilege('authenticated', c.oid, 'usage')
           or has_sequence_privilege('authenticated', c.oid, 'update')
           or has_sequence_privilege('anon', c.oid, 'usage'))),
  0, 'anon/authenticated have no sequence privileges in public');

-- أعمدة المنتجات والعناوين القابلة للكتابة فقط
select ok(not has_column_privilege('authenticated', 'public.products', 'in_stock', 'update'),
  'products.in_stock is not writable (follows stock)');
select ok(not has_column_privilege('authenticated', 'public.products', 'in_stock', 'insert'),
  'products.in_stock cannot be set on insert');
select ok(not has_column_privilege('authenticated', 'public.products', 'id', 'insert'),
  'products.id cannot be chosen by the client');
select ok(not has_column_privilege('authenticated', 'public.products', 'price_iqd', 'update'),
  'products.price_iqd is not directly writable (admin_save_product / set_product_price, T18)');
select ok(not has_column_privilege('authenticated', 'public.addresses', 'customer_id', 'update'),
  'addresses.customer_id cannot be changed');
select ok(not has_column_privilege('authenticated', 'public.addresses', 'id', 'insert'),
  'addresses.id cannot be chosen by the client');
select ok(has_column_privilege('authenticated', 'public.addresses', 'apartment', 'update'),
  'addresses.apartment is writable (owner via RLS)');

-- الإعدادات: الحد الأدنى من مضاعفات 250، وحد الطلبات النشطة افتراضياً 3
select throws_ok($$ update public.app_settings set min_order_iqd = 100 $$, '23514', null,
  'min_order_iqd must be a multiple of 250');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'app_settings' and column_name = 'max_active_orders'),
  '3', 'max_active_orders defaults to 3');
select ok(not has_table_privilege('authenticated', 'public.app_settings', 'update'),
  'app_settings is not directly writable (update_app_settings, T19)');

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

-- تغيير هاتف الحساب ينعكس على الملف الشخصي
update auth.users set phone = '9647922222222' where id = '00000000-0000-0000-0000-0000000000a1';
select is((select phone from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  '9647922222222', 'profiles.phone follows auth.users.phone on update');

-- منتج جديد: صف مخزون بصفر، وغير متوفر
select tests.remember('p_new', tests.new_product(500, 0));
select is((select qty from public.stock where product_id = tests.id('p_new')), 0,
  'new product gets a stock row with qty 0');
select is((select in_stock from public.products where id = tests.id('p_new')), false,
  'product without stock is in_stock = false');

select * from finish();
