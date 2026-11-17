-- 31: جلسة الإصلاح F (migration 20261202000001، docs/reviews/review-E1-E2.md):
--   H1 إشعارات الأدمن/الموظف بجلسة aal2 حيّة فقط، M1 تقييمات الموظف آخر 7 أيام، M2 الرمز المؤقت قبل TOTP،
--   M3 حد قيمة الطلب، M4 panel_session_alive، L3 علامة البيئة، L5 محو سبب الإلغاء وإشعارات الطلب، L6 تنظيف الجلسات.
--   (L4 بـ 30_security_e2، L7 بـ 12_delete_account، سباقات M3 بـ scripts/db-concurrency.mjs)
select plan(70);

create function tests.f_err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || ':' || coalesce(v_detail, '');
end $$;
grant execute on function tests.f_err(text) to anon, authenticated, service_role;

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('drv',   tests.new_user('driver'));
select tests.remember('cust',  tests.new_user('customer'));

-- ================================================================ H1: الإشعارات بجلسة aal2
select is((select count(*)::int from public.push_tokens t join public.profiles p on p.id = t.user_id
            where p.role in ('admin', 'staff') and t.session_id is null), 0,
  'no admin/staff push token without a session (old ones purged by the migration)');

select tests.as_user_aal1(tests.id('staff'));
select throws_ok($$ select public.register_push_token('ExponentPushToken[f-aal1]', 'ios') $$,
  '42501', 'MFA_REQUIRED', 'staff on a PIN-only (aal1) session cannot register a push token');
select tests.as_user(tests.id('staff'));
select throws_ok($$ select public.register_push_token('ExponentPushToken[f-nosess]', 'ios') $$,
  '42501', 'MFA_REQUIRED', 'staff token without a session id is refused');
select tests.as_postgres();
select tests.remember('s_ok', tests.panel_session(tests.id('staff')));
select tests.as_panel(tests.id('staff'), tests.id('s_ok'));
select lives_ok($$ select public.register_push_token('ExponentPushToken[f-staff-ok]', 'ios') $$,
  'staff on an aal2 session registers');
select tests.as_postgres();
select is((select session_id from public.push_tokens where token = 'ExponentPushToken[f-staff-ok]'), tests.id('s_ok'),
  'the token is bound to that session');

-- جلسة خاملة 13 ساعة: لا تسجيل
select tests.remember('s_idle', tests.panel_session(tests.id('staff')));
insert into private.panel_sessions (session_id, user_id, last_seen)
values (tests.id('s_idle'), tests.id('staff'), now() - interval '13 hours');
select tests.as_panel(tests.id('staff'), tests.id('s_idle'));
select throws_ok($$ select public.register_push_token('ExponentPushToken[f-idle]', 'ios') $$,
  '42501', 'MFA_REQUIRED', 'an idle (12 h) panel session cannot register');

select tests.as_user(tests.id('drv'));
select lives_ok($$ select public.register_push_token('ExponentPushToken[f-drv]', 'android') $$,
  'driver registers without a panel session (unchanged)');
select tests.as_postgres();
select is((select session_id from public.push_tokens where token = 'ExponentPushToken[f-drv]'), null,
  'driver token carries no session');

-- المستلمون: aal2 حيّة فقط
insert into public.push_tokens (user_id, token, platform, session_id) values
  (tests.id('admin'), 'ExponentPushToken[f-adm-aal2]', 'ios', tests.panel_session(tests.id('admin'))),
  (tests.id('admin'), 'ExponentPushToken[f-adm-aal1]', 'ios', tests.panel_session(tests.id('admin'), 'aal1')),
  (tests.id('staff'), 'ExponentPushToken[f-stf-idle]', 'ios', tests.id('s_idle')),
  (tests.id('staff'), 'ExponentPushToken[f-stf-gone]', 'ios', gen_random_uuid()),
  (tests.id('staff'), 'ExponentPushToken[f-stf-null]', 'ios', null);
update public.notification_outbox set sent_at = now() where sent_at is null;
insert into public.notification_outbox (audience, user_id, title, body) values
  ('admins',      null,              'F-admins',      'b'),
  ('admins_only', null,              'F-admins-only', 'b'),
  ('user',        tests.id('admin'), 'F-admin-user',  'b'),
  ('drivers',     null,              'F-drivers',     'b');
create temp table f_claimed (id bigint, title text, body text, data jsonb, attempts int, recipients jsonb);
grant all on f_claimed to service_role;
select tests.as_service();
insert into f_claimed select * from public.claim_push_notifications(50);
select tests.as_postgres();
select is((select jsonb_path_query_array(recipients, '$[*].token') from f_claimed where title = 'F-admins'),
  '["ExponentPushToken[f-staff-ok]", "ExponentPushToken[f-adm-aal2]"]'::jsonb,
  'admins audience: only tokens of live aal2 sessions (not aal1, idle, deleted or session-less)');
select is((select jsonb_path_query_array(recipients, '$[*].token') from f_claimed where title = 'F-admins-only'),
  '["ExponentPushToken[f-adm-aal2]"]'::jsonb, 'admins_only: same rule');
select is((select jsonb_path_query_array(recipients, '$[*].token') from f_claimed where title = 'F-admin-user'),
  '["ExponentPushToken[f-adm-aal2]"]'::jsonb, 'a personal push to an admin: same rule');
select ok((select recipients @> '[{"token": "ExponentPushToken[f-drv]"}]' from f_claimed where title = 'F-drivers'),
  'drivers are unaffected (no session needed)');
select ok(not has_function_privilege('authenticated', 'private.panel_push_session_ok(uuid)', 'execute'),
  'the session check is not callable by users');

-- إعادة ضبط المصادقة الثنائية تحذف رموز الحساب
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.admin_reset_mfa(%L) $$, tests.id('staff')), 'admin resets staff MFA');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id = tests.id('staff')), 0,
  'MFA reset deletes the push tokens');

-- ================================================================ M1: التقييمات (الموظف 7 أيام)
select tests.remember('r_new', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('r_edge', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('r_old', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
insert into public.ratings (order_id, customer_id, stars, comment, created_at) values
  (tests.id('r_new'),  tests.id('cust'), 5, 'جديد', now()),
  (tests.id('r_edge'), tests.id('cust'), 4, 'حافة', private.baghdad_start(public.baghdad_today() - 6)),
  (tests.id('r_old'),  tests.id('cust'), 1, 'قديم', private.baghdad_start(public.baghdad_today() - 6) - interval '1 second');

select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.ratings_list(null, null, 1, 5, false, null, null, 100)
            where order_id in (tests.id('r_new'), tests.id('r_edge'), tests.id('r_old'))), 2,
  'staff list: today and day -6 (Baghdad) yes, one second earlier no');
select is((select count(*)::int from public.ratings_list('2000-01-01', null, 1, 5, false, null, null, 100)
            where order_id = tests.id('r_old')), 0, 'staff list: an explicit older from-date does not widen the window');
select is((select count(*)::int from public.ratings
            where order_id in (tests.id('r_new'), tests.id('r_edge'), tests.id('r_old'))), 2,
  'staff RLS on ratings: same window');
select is((public.ratings_summary() ->> 'count')::int,
  (select count(*)::int from public.ratings
    where created_at >= ((public.baghdad_today() - 6)::timestamp at time zone 'Asia/Baghdad')),
  'staff summary counts only the window');
select tests.as_user(tests.id('admin'));
select is((select count(*)::int from public.ratings_list(null, null, 1, 5, false, null, null, 100)
            where order_id in (tests.id('r_new'), tests.id('r_edge'), tests.id('r_old'))), 3, 'admin sees all ratings');
select is((select count(*)::int from public.ratings
            where order_id in (tests.id('r_new'), tests.id('r_edge'), tests.id('r_old'))), 3, 'admin RLS: all');
select tests.as_user(tests.id('cust'));
select is((select count(*)::int from public.ratings where order_id = tests.id('r_old')), 1,
  'the customer still sees their own old rating');

-- ================================================================ M2: الرمز المؤقت قبل TOTP
select tests.as_postgres();
select tests.remember('c_promo', tests.new_user('customer'));
select tests.remember('d_promo', tests.new_user('driver'));
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), tests.id('c_promo'), 'f-old', 'totp', 'verified', now() - interval '1 day', now(), 'S');

select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.set_user_role(%L, 'staff', true) $$, tests.id('c_promo')),
  'P0001', 'PIN_RESET_REQUIRED', 'customer → staff without a temporary PIN: refused');
select throws_ok(format($$ select public.set_user_role(%L, 'admin', true) $$, tests.id('d_promo')),
  'P0001', 'PIN_RESET_REQUIRED', 'driver → admin without a temporary PIN: refused');
select lives_ok(format($$ select public.set_user_role(%L, 'driver', true) $$, tests.id('c_promo')),
  'customer → driver is not a panel promotion (allowed)');
select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('c_promo');
select ok((select pin_reset_at = now() from public.profiles where id = tests.id('c_promo')),
  'setting the temporary-PIN flag stamps pin_reset_at');
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'staff', true) $$, tests.id('c_promo')),
  'with a temporary PIN the promotion works');
select tests.as_postgres();
select is((select count(*)::int from auth.mfa_factors where user_id = tests.id('c_promo')), 0,
  'the promotion wipes any TOTP factor enrolled before it');
select ok(exists (select 1 from public.admin_audit where action = 'mfa_reset' and target_id = tests.id('c_promo')
                   and after ->> 'via' = 'promotion'), 'the wipe is audited (mfa_reset via promotion)');
select is((select must_change_pin from public.profiles where id = tests.id('c_promo')), true,
  'the promoted account still has to change the PIN first');

-- تسجيل TOTP أثناء الرمز المؤقت (مثلاً من سرق الرمز المؤقت): يُحذف عند تغيير الرمز
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), tests.id('c_promo'), 'f-window', 'totp', 'verified', now(), now(), 'S');
update auth.users set encrypted_password = 'changed-' || gen_random_uuid() where id = tests.id('c_promo');
select is((select must_change_pin from public.profiles where id = tests.id('c_promo')), false, 'the PIN change clears the flag');
select is((select count(*)::int from auth.mfa_factors where user_id = tests.id('c_promo')), 0,
  'a factor enrolled while the PIN was temporary is removed at the PIN change');
select ok(exists (select 1 from public.admin_audit where action = 'mfa_reset' and target_id = tests.id('c_promo')
                   and after ->> 'via' = 'temporary_pin_window'), 'and audited (temporary_pin_window)');

-- عامل قديم (قبل إعادة الضبط) يبقى: الموظف الذي نسي الرمز لا يفقد تطبيقه
select tests.remember('s_old', tests.new_user('staff'));
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), tests.id('s_old'), 'f-keep', 'totp', 'verified', now() - interval '1 hour', now(), 'S');
update public.profiles set must_change_pin = true where id = tests.id('s_old');
update auth.users set encrypted_password = 'changed-' || gen_random_uuid() where id = tests.id('s_old');
select is((select count(*)::int from auth.mfa_factors where user_id = tests.id('s_old')), 1,
  'a factor enrolled before the PIN reset is kept at the PIN change');
-- الزبون: لا يُمس
select tests.remember('c_flag', tests.new_user('customer'));
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), tests.id('c_flag'), 'f-cust', 'totp', 'verified', now(), now(), 'S');
update public.profiles set must_change_pin = true where id = tests.id('c_flag');
update auth.users set encrypted_password = 'changed-' || gen_random_uuid() where id = tests.id('c_flag');
select is((select count(*)::int from auth.mfa_factors where user_id = tests.id('c_flag')), 1,
  'customers are not affected by the temporary-PIN window rule');
-- ترقية موظف إلى أدمن: ليست من زبون/سائق، بلا شرط
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'admin', true) $$, tests.id('s_old')),
  'staff → admin needs no PIN reset (already a panel account with TOTP)');
select tests.as_postgres();

-- ================================================================ M3: حد قيمة الطلب
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'app_settings' and column_name = 'max_order_iqd'), '200000',
  'max_order_iqd defaults to 200,000');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'app_settings' and column_name = 'new_account_max_order_iqd'), '50000',
  'new_account_max_order_iqd defaults to 50,000');

select tests.as_user(tests.id('admin'));
select throws_ok($$ select public.update_app_settings('{"max_order_iqd": 200100}') $$, 'P0001', 'INVALID_SETTINGS',
  'max_order_iqd must be a multiple of 250');
select throws_ok($$ select public.update_app_settings('{"new_account_max_order_iqd": 0}') $$, 'P0001', 'INVALID_SETTINGS',
  'new_account_max_order_iqd must be at least 250');
select throws_ok($$ select public.update_app_settings('{"max_order_iqd": "200000"}') $$, 'P0001', 'INVALID_SETTINGS',
  'a string is refused');
select lives_ok($$ select public.update_app_settings('{"max_order_iqd": 200000, "new_account_max_order_iqd": 50000, "delivery_fee_iqd": 2000, "min_order_iqd": 0}') $$,
  'admin sets both caps');
select tests.as_postgres();
select ok(exists (select 1 from public.admin_audit where action = 'settings' and actor = tests.id('admin')
                   and after ? 'max_order_iqd' and after ? 'new_account_max_order_iqd'), 'the change is audited');
select tests.as_user(tests.id('staff'));
select throws_ok($$ select public.update_app_settings('{"max_order_iqd": 1000000}') $$, '42501', 'NOT_ALLOWED',
  'staff cannot change the caps');

select tests.as_postgres();
select tests.remember('pc', tests.new_product(12000, 1000));
select tests.remember('new_c', tests.new_user('customer'));
select tests.remember('new_a', tests.new_address(tests.id('new_c')));
select tests.remember('old_c', tests.new_user('customer'));
select tests.remember('old_a', tests.new_address(tests.id('old_c')));
select tests.remember('old_done', tests.order_in('delivered', tests.id('old_c')));

create function tests.cap_sql(p_addr uuid, p_qty int) returns text language sql as $$
  select format('select public.place_order(%L, %L::jsonb, %L)', p_addr,
                jsonb_build_array(tests.item(tests.id('pc'), p_qty)), gen_random_uuid())
$$;
grant execute on function tests.cap_sql(uuid, int) to authenticated;

select tests.as_user(tests.id('new_c'));
select is(tests.f_err(tests.cap_sql(tests.id('new_a'), 4)), 'OK',
  'new account: 4 × 12,000 + 2,000 delivery = 50,000 exactly is allowed');
select is(tests.f_err(tests.cap_sql(tests.id('new_a'), 5)), 'NEW_ACCOUNT_ORDER_LIMIT:50000',
  'new account: 62,000 is refused with the limit as detail');
select tests.as_user(tests.id('old_c'));
select is(tests.f_err(tests.cap_sql(tests.id('old_a'), 5)), 'OK', 'after a delivered order: 62,000 is fine');
select is(tests.f_err(tests.cap_sql(tests.id('old_a'), 16)), 'OK', '16 × 12,000 + 2,000 = 194,000 is fine');
select is(tests.f_err(tests.cap_sql(tests.id('old_a'), 17)), 'ORDER_TOO_LARGE:200000',
  '206,000 is refused for everyone (detail = the limit)');
select tests.as_user(tests.id('new_c'));
select is(tests.f_err(tests.cap_sql(tests.id('new_a'), 17)), 'NEW_ACCOUNT_ORDER_LIMIT:50000',
  'new account over both caps: the new-account message (the smaller limit)');
-- حد الحساب الجديد أكبر من العام: العام يحكم
select tests.as_postgres();
update public.app_settings set new_account_max_order_iqd = 300000;
select tests.as_user(tests.id('new_c'));
select is(tests.f_err(tests.cap_sql(tests.id('new_a'), 17)), 'ORDER_TOO_LARGE:200000',
  'a new-account cap above the general one: the general cap applies');
select tests.as_postgres();
select is((select count(*)::int from public.orders where customer_id = tests.id('new_c')), 1,
  'refused orders leave nothing behind');
select is((select qty from public.stock where product_id = tests.id('pc')), 1000 - 4 - 5 - 16,
  'and take no stock');

-- ================================================================ M4: panel_session_alive
select tests.as_anon();
select throws_ok($$ select public.panel_session_alive() $$, '42501', null, 'anon cannot call panel_session_alive');
select tests.as_postgres();
select tests.remember('s_live', tests.panel_session(tests.id('admin')));
select tests.as_panel(tests.id('admin'), tests.id('s_live'));
select is(public.panel_session_alive(), true, 'live aal2 admin session: alive');
select tests.as_postgres();
select is((select count(*)::int from private.panel_sessions where session_id = tests.id('s_live')), 0,
  'the poll does not record activity (read only)');
insert into private.panel_sessions (session_id, user_id, last_seen)
values (tests.id('s_live'), tests.id('admin'), now() - interval '13 hours');
select tests.as_panel(tests.id('admin'), tests.id('s_live'));
select is(public.panel_session_alive(), false, '13 h idle: not alive');
select tests.as_user_aal1(tests.id('admin'));
select is(public.panel_session_alive(), false, 'aal1: not alive');
select tests.as_user(tests.id('cust'));
select is(public.panel_session_alive(), false, 'customer: not a panel session');

-- ================================================================ L6: تنظيف جلسات اللوحة الخاملة
select tests.as_postgres();
select tests.remember('s_fresh', tests.panel_session(tests.id('admin')));
insert into private.panel_sessions (session_id, user_id, last_seen) values (tests.id('s_fresh'), tests.id('admin'), now());
select private.purge_push_history();
select is((select count(*)::int from auth.sessions where id = tests.id('s_live')), 0,
  'the daily purge deletes idle (> 12 h) panel sessions from Auth');
select is((select count(*)::int from auth.sessions where id = tests.id('s_fresh')), 1, 'active ones stay');

-- ================================================================ L3: علامة البيئة
select has_table('private', 'deployment', 'private.deployment exists');
select ok(not has_table_privilege('authenticated', 'private.deployment', 'select'),
  'the marker is not readable by users');
select throws_ok($$ insert into private.deployment (id, env) values (false, 'dev') $$, '23514', null,
  'one row only (id must be true)');

-- ================================================================ L5: محو سبب الإلغاء وإشعارات الطلب
select tests.remember('gone', tests.new_user('customer'));
select tests.remember('o_gone', tests.order_in('pending', tests.id('gone')));
select tests.remember('o_gone2', tests.order_in('pending', tests.id('gone')));
select tests.as_user(tests.id('gone'));
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled', %L) $$, tests.id('o_gone'),
  'ما أريده' || chr(8238) || ' الآن'), 'the customer cancels with a reason');
select tests.as_postgres();
select is((select cancel_reason from public.orders where id = tests.id('o_gone')), 'ما أريده الآن',
  'the cancel reason is cleaned (no bidi override)');
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o_gone2'), 'cancelled', 'نفد المخزون');
select tests.as_postgres();
delete from auth.users where id = tests.id('gone');
select is((select cancel_reason from public.orders where id = tests.id('o_gone')), null,
  'deleted account: the reason the customer wrote is erased');
select is((select count(*)::int from public.order_status_history where order_id = tests.id('o_gone') and note is not null), 0,
  'and the same text in the status history');
select is((select cancel_reason from public.orders where id = tests.id('o_gone2')), 'نفد المخزون',
  'a reason written by the admin stays');
select is((select count(*)::int from public.notification_outbox
            where data ->> 'order_id' in (tests.id('o_gone')::text, tests.id('o_gone2')::text)), 0,
  'the push history of the customer''s orders is deleted');

select * from finish();
