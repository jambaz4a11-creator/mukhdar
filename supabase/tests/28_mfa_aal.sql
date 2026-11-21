-- 28: المصادقة الثنائية للأدمن والموظف (T23 C1، migration 20261130000001).
--   current_user_role() = admin/staff فقط بجلسة aal2. بالـ PIN وحده (aal1) كل دالة أدمن/موظف ترفض
--   (42501 NOT_ALLOWED أو 28000 NOT_AUTHENTICATED من set_order_status)، وكذلك قراءات وكتابات RLS.
--   الزبون والسائق بلا تغيير. admin_reset_mfa (أدمن aal2، غير أدمن، مُدقَّقة، تبطل الجلسات) و
--   break_glass_reset_mfa (service_role، أدمن فقط).
--   الكتالوج: كل دالة SECURITY DEFINER ينفّذها authenticated غير دوال الزبون/السائق يجب أن تكون بالمصفوفة.
select plan(44);

-- ================================================================ التجهيز (postgres)
create function tests.gate_try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

select tests.remember('cust',   tests.new_user('customer'));
select tests.remember('drv',    tests.new_user('driver'));
select tests.remember('admin',  tests.new_user('admin'));
select tests.remember('admin2', tests.new_user('admin'));
select tests.remember('staff',  tests.new_user('staff'));
select tests.remember('staff2', tests.new_user('staff'));
select tests.remember('prod',   tests.new_product(1000, 50, true, 750));
select tests.remember('order',  tests.order_in('pending', tests.id('cust')));
with s as (insert into public.sectors (name) values ('aal sector') returning id),
     ss as (insert into public.subsections (sector_id, name) select id, 'Z1' from s returning id)
select set_config('t.sub', (select id::text from ss), true);

-- staff = للموظف والأدمن، admin = أدمن فقط. أي دالة أدمن/موظف جديدة تُضاف هنا (الفحص الأخير).
create function tests.gate_calls() returns table (grp text, sql text) language sql as $$
  select * from (values
    ('staff', $q$ select public.dashboard_today() $q$),
    ('staff', $q$ select public.ratings_summary() $q$),
    ('staff', $q$ select * from public.ratings_list() $q$),
    ('staff', $q$ select * from public.list_drivers() $q$),
    ('staff', format($q$ select public.set_order_status(%L, 'preparing') $q$, tests.id('order'))),
    ('staff', format($q$ select public.assign_driver(%L, %L) $q$, tests.id('order'), tests.id('drv'))),
    ('admin', $q$ select public.report_summary(current_date - 7, current_date) $q$),
    ('admin', $q$ select * from public.report_daily(current_date - 7, current_date) $q$),
    ('admin', $q$ select * from public.report_orders_placed(current_date - 7, current_date) $q$),
    ('admin', $q$ select * from public.report_top_products(current_date - 7, current_date) $q$),
    ('admin', $q$ select * from public.report_drivers(current_date - 7, current_date) $q$),
    ('admin', $q$ select * from public.report_waste(current_date - 7, current_date) $q$),
    ('admin', $q$ select public.stuck_notifications_count() $q$),
    ('admin', $q$ select public.failed_notifications_count() $q$),
    ('admin', $q$ select public.dismiss_failed_notifications() $q$),
    ('admin', format($q$ select public.add_buildings(%s, array['100']) $q$, current_setting('t.sub'))),
    ('admin', $q$ select public.address_usage('sectors', 1) $q$),
    ('admin', format($q$ select public.adjust_stock(%L, 1, 'adjust', 'aal test') $q$, tests.id('prod'))),
    ('admin', format($q$ select public.adjust_stock_bulk(%L::jsonb, 'adjust', 'aal test') $q$,
                     jsonb_build_array(jsonb_build_object('product_id', tests.id('prod'), 'qty', 1)))),
    ('admin', format($q$ select public.admin_save_product(%L::jsonb) $q$,
                     jsonb_build_object('id', tests.id('prod'), 'description', 'aal'))),
    ('admin', format($q$ select public.set_product_price(%L, 1250) $q$, tests.id('prod'))),
    ('admin', format($q$ select public.reorder_products(array[%L]::uuid[]) $q$, tests.id('prod'))),
    ('admin', $q$ select public.admin_save_category('{"name": "aal matrix cat"}'::jsonb) $q$),
    ('admin', $q$ select public.delete_category(999999) $q$),
    ('admin', $q$ select public.reorder_categories(array[999999]) $q$),
    ('admin', $q$ select public.recompute_daily_stats(current_date, current_date) $q$),
    ('admin', format($q$ select public.set_user_role(%L, 'customer', true) $q$, tests.id('cust'))),
    ('admin', $q$ select public.update_app_settings('{}'::jsonb) $q$),
    ('admin', format($q$ select public.admin_reset_mfa(%L) $q$, tests.id('staff2'))),
    ('admin', format($q$ select public.admin_cancel_customer_orders(%L) $q$, gen_random_uuid())),
    ('admin', $q$ select * from public.list_driver_requests() $q$),
    ('admin', $q$ select public.pending_driver_requests_count() $q$),
    ('admin', format($q$ select public.decide_driver_request(%L, false) $q$, gen_random_uuid()))
  ) t(grp, sql)
$$;

-- النداءات التي **لم** تُرفض (refused = 42501 أو 28000)؛ '' = كلها رُفضت
create function tests.not_refused(p_scope text) returns text language sql as $$
  select coalesce(string_agg(c.sql, ' ; '), '') from tests.gate_calls() c
   where case when p_scope = 'all' or c.grp = p_scope then tests.gate_try(c.sql) not in ('42501', '28000') end
$$;
-- النداءات التي رُفضت؛ '' = كلها مرّت من بوابة الدور (قد ترجع خطأ عمل آخر، وهذا مقبول)
create function tests.refused(p_scope text) returns text language sql as $$
  select coalesce(string_agg(c.sql, ' ; '), '') from tests.gate_calls() c
   where case when p_scope = 'all' or c.grp = p_scope then tests.gate_try(c.sql) in ('42501', '28000') end
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- عوامل TOTP وجلسات (كما يكتبها GoTrue) لموظفَين وأدمن
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), u, 'test ' || u, 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'
  from unnest(array[tests.id('staff2'), tests.id('admin2'), tests.id('staff')]) u;
insert into auth.sessions (id, user_id, created_at, updated_at)
select gen_random_uuid(), u, now(), now()
  from unnest(array[tests.id('staff2'), tests.id('admin2')]) u;

-- ================================================================ بوابة الدور
select tests.as_user_aal1(tests.id('admin'));
select is(private.current_user_role()::text, null, 'admin with aal1 (PIN only): no role');
select ok(not private.is_admin() and not private.is_staff_or_admin(), 'admin with aal1: is_admin / is_staff_or_admin false');
select tests.as_user(tests.id('admin'));
select is(private.current_user_role()::text, 'admin', 'admin with aal2: admin');
select tests.as_user_aal1(tests.id('staff'));
select is(private.current_user_role()::text, null, 'staff with aal1: no role');
select tests.as_user(tests.id('staff'));
select ok(private.is_staff_or_admin() and not private.is_admin(), 'staff with aal2: staff, not admin');
-- رمز قديم بلا claim aal
select tests.as_postgres();
select set_config('request.jwt.claims', json_build_object('sub', tests.id('admin'), 'role', 'authenticated')::text, true);
select is(private.current_user_role()::text, null, 'admin token without an aal claim: no role');
select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('admin2');
select tests.as_user(tests.id('admin2'));
select is(private.current_user_role()::text, null, 'aal2 does not override a temporary PIN');
select tests.as_postgres();
update public.profiles set must_change_pin = false where id = tests.id('admin2');
-- الزبون والسائق لا يحتاجان aal2
select tests.as_user_aal1(tests.id('cust'));
select is(private.current_user_role()::text, 'customer', 'customer with aal1: customer (unchanged)');
select tests.as_user_aal1(tests.id('drv'));
select is(private.current_user_role()::text, 'driver', 'driver with aal1: driver (unchanged)');
select is(tests.gate_try($q$ select * from public.available_orders() $q$), 'ok', 'driver with aal1: available_orders works');

-- ================================================================ كل دوال الأدمن/الموظف
select tests.as_user_aal1(tests.id('admin'));
select is(tests.not_refused('all'), '', 'admin aal1: every admin/staff RPC refused');
select tests.as_user_aal1(tests.id('staff'));
select is(tests.not_refused('all'), '', 'staff aal1: every admin/staff RPC refused');
select tests.as_user(tests.id('staff'));
select is(tests.refused('staff'), '', 'staff aal2: every staff RPC passes the role gate');
select is(tests.not_refused('admin'), '', 'staff aal2: admin-only RPCs still refused');
select tests.as_user(tests.id('admin'));
select is(tests.refused('all'), '', 'admin aal2: every admin/staff RPC passes the role gate');

-- ================================================================ RLS (قراءة وكتابة)
select tests.as_user_aal1(tests.id('staff'));
select is((select count(*)::int from public.orders where id = tests.id('order')), 0, 'staff aal1: cannot read a customer order');
select is((select count(*)::int from public.stock), 0, 'staff aal1: cannot read stock');
select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.orders where id = tests.id('order')), 1, 'staff aal2: reads the order');
select ok((select count(*)::int from public.stock) > 0, 'staff aal2: reads stock');
select tests.as_user_aal1(tests.id('admin'));
select is((select count(*)::int from public.product_costs), 0, 'admin aal1: cannot read product_costs');
select is((select count(*)::int from public.profiles), 1, 'admin aal1: reads only the own profile (to route to the MFA page)');
select is((select count(*)::int from public.admin_audit), 0, 'admin aal1: cannot read admin_audit');
select is(tests.gate_try($q$ select public.admin_save_category('{"name": "aal1 cat"}'::jsonb) $q$), '42501',
  'admin aal1: cannot write categories (function gate)');
select tests.as_user(tests.id('admin'));
select ok((select count(*)::int from public.product_costs) > 0, 'admin aal2: reads product_costs');
select ok((select count(*)::int from public.profiles) > 1, 'admin aal2: reads every profile');
select is(tests.gate_try($q$ select public.admin_save_category('{"name": "aal2 cat"}'::jsonb) $q$), 'ok',
  'admin aal2: writes categories');

-- ================================================================ admin_reset_mfa
select tests.as_postgres();
select is((select count(*)::int from auth.mfa_factors where user_id = tests.id('staff2')), 0,
  'admin aal2 call above removed staff2''s factors');
select is((select count(*)::int from auth.sessions where user_id = tests.id('staff2')), 0,
  '… and revoked staff2''s sessions');
select results_eq(
  format($q$ select actor, action, (before ->> 'factors')::int, after ->> 'via' from public.admin_audit
              where target_id = %L and action = 'mfa_reset' $q$, tests.id('staff2')),
  format($q$ values (%L::uuid, 'mfa_reset'::text, 1, 'panel'::text) $q$, tests.id('admin')),
  'mfa_reset is audited (actor, factor count, via panel)');
select tests.as_user(tests.id('admin'));
select throws_ok(format($q$ select public.admin_reset_mfa(%L) $q$, tests.id('admin2')),
  'P0001', 'ADMIN_ACCOUNT', 'admin_reset_mfa refuses another admin');
select throws_ok(format($q$ select public.admin_reset_mfa(%L) $q$, tests.id('admin')),
  'P0001', 'ADMIN_ACCOUNT', 'admin_reset_mfa refuses the caller');
select throws_ok(format($q$ select public.admin_reset_mfa(%L) $q$, gen_random_uuid()),
  'P0001', 'USER_NOT_FOUND', 'admin_reset_mfa: unknown user');
select tests.as_user(tests.id('staff'));
select throws_ok(format($q$ select public.admin_reset_mfa(%L) $q$, tests.id('staff')),
  '42501', 'NOT_ALLOWED', 'staff (aal2) cannot reset 2FA');
select tests.as_postgres();
select ok(not has_function_privilege('anon', 'public.admin_reset_mfa(uuid)', 'execute'), 'anon cannot call admin_reset_mfa');

-- ================================================================ break_glass_reset_mfa (service_role)
select ok(not has_function_privilege('authenticated', 'public.break_glass_reset_mfa(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.break_glass_reset_mfa(uuid)', 'execute'),
  'break_glass_reset_mfa: service_role only');
select tests.as_service();
select throws_ok(format($q$ select public.break_glass_reset_mfa(%L) $q$, tests.id('staff')),
  'P0001', 'INVALID_REQUEST', 'break-glass: admin accounts only');
select is(public.break_glass_reset_mfa(tests.id('admin2')), 1, 'break-glass removes the admin''s factor');
select tests.as_postgres();
select ok(not exists (select 1 from auth.mfa_factors where user_id = tests.id('admin2'))
          and not exists (select 1 from auth.sessions where user_id = tests.id('admin2'))
          and exists (select 1 from public.admin_audit where target_id = tests.id('admin2') and action = 'mfa_reset'
                        and actor is null and after ->> 'via' = 'break_glass'),
  'break-glass: no factor, no session, audited with actor null');

-- ================================================================ اسم حساب TOTP (C1.3)
-- GoTrue لا يسجّل TOTP لحساب بلا بريد: الأدمن والموظف يأخذان بريد وسم غير مؤكَّد؛ الزبون والسائق لا
select tests.as_postgres();
select is((select email::text from auth.users where id = tests.id('staff')),
  (select phone::text from auth.users where id = tests.id('staff')) || '@phone.mukhdar.invalid',
  'staff gets the label <phone>@phone.mukhdar.invalid');
select ok((select email_confirmed_at is null from auth.users where id = tests.id('admin')),
  'the label is NOT a confirmed email (no sign-in with it)');
select ok((select email is null from auth.users where id = tests.id('cust'))
          and (select email is null from auth.users where id = tests.id('drv')),
  'customers and drivers get no label');
update public.profiles set role = 'staff' where id = tests.id('cust');
select is((select email::text from auth.users where id = tests.id('cust')),
  (select phone::text from auth.users where id = tests.id('cust')) || '@phone.mukhdar.invalid',
  'promotion to staff (profiles.role) adds the label');
update auth.users set email = 'real@example.com' where id = tests.id('drv');
update public.profiles set role = 'admin' where id = tests.id('drv');
select is((select email::text from auth.users where id = tests.id('drv')), 'real@example.com',
  'an existing real email is never overwritten');

-- ================================================================ الكتالوج
select set_eq(
  $$ select p.proname::text collate "default" from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and has_function_privilege('authenticated', p.oid, 'execute')
        -- register_web_push (T36): مثل register_push_token، بوابة MFA خاصة بالأدمن/الموظف (37_webpush_db)
        and p.proname not in ('place_order', 'rate_order', 'register_push_token', 'register_web_push', 'available_orders',
                            'accept_order', 'touch_panel_session', 'driver_request_status') $$,
  $$ select distinct (regexp_match(sql, 'public\.(\w+)\('))[1] from tests.gate_calls() $$,
  'the aal matrix covers every admin/staff SECURITY DEFINER RPC (a new one must be added)');

select * from finish();
