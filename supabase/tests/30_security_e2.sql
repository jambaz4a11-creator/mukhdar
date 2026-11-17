-- 30: مراجعة الأمان T23 جلسة E2 (migration 20261201000001):
--   H2 حد الحساب الجديد + admin_cancel_customer_orders، M5 محو هوية الطلبات عند حذف الحساب (+ 12_delete_account)،
--   M6 نافذة الموظف (مفتوح + 7 أيام بغداد)، M7 خمول جلسة اللوحة 12 ساعة، L2 حد رموز الإشعارات، L3 تنظيف النص وحد العناوين.
select plan(89);

create function tests.err_detail(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || ':' || coalesce(v_detail, '');
end $$;
create function tests.as_session(p_uid uuid, p_sid uuid, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function tests.err_detail(text), tests.as_session(uuid, uuid, text) to anon, authenticated, service_role;

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('drv',   tests.new_user('driver'));
select tests.remember('cust',  tests.new_user('customer'));
select tests.remember('p',     tests.new_product(500, 200));
select tests.remember('addr',  tests.new_address(tests.id('cust')));

create function tests.order_sql(p_uid uuid, p_addr uuid, p_qty int default 1) returns text language sql as $$
  select format('select public.place_order(%L, %L::jsonb, %L)', p_addr,
                jsonb_build_array(tests.item(tests.id('p'), p_qty)), gen_random_uuid())
$$;
grant execute on function tests.order_sql(uuid, uuid, int) to authenticated;

-- ================================================================ H2: حد الحساب الجديد
select is((select new_account_max_active_orders from public.app_settings), 1000,
  'helpers raise the new-account limit (the real default is checked below)');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'app_settings'
              and column_name = 'new_account_max_active_orders'), '1', 'new_account_max_active_orders defaults to 1');
update public.app_settings set new_account_max_active_orders = 1, max_active_orders = 3;

select tests.as_user(tests.id('cust'));
select is(tests.err_detail(tests.order_sql(tests.id('cust'), tests.id('addr'))), 'OK', 'new account: first order accepted');
select is(tests.err_detail(tests.order_sql(tests.id('cust'), tests.id('addr'))), 'TOO_MANY_ACTIVE_ORDERS:1',
  'new account: second open order refused, detail = 1');

-- الإلغاء لا يُحسب "تسليماً": يبقى الحد 1
select tests.as_postgres();
update public.orders set status = 'cancelled' where customer_id = tests.id('cust');
select tests.as_user(tests.id('cust'));
select is(tests.err_detail(tests.order_sql(tests.id('cust'), tests.id('addr'))), 'OK', 'after a cancel: one open order allowed');
select is(tests.err_detail(tests.order_sql(tests.id('cust'), tests.id('addr'))), 'TOO_MANY_ACTIVE_ORDERS:1',
  'a cancelled order does not lift the new-account limit');

-- أول تسليم يرفع الحد إلى max_active_orders (3)
select tests.as_postgres();
update public.orders set status = 'delivered', delivered_at = now()
 where id = (select id from public.orders where customer_id = tests.id('cust') and status = 'pending');
select tests.as_user(tests.id('cust'));
select is(tests.err_detail(tests.order_sql(tests.id('cust'), tests.id('addr'))), 'OK', 'after first delivery: 1st open order');
select is(tests.err_detail(tests.order_sql(tests.id('cust'), tests.id('addr'))), 'OK', 'after first delivery: 2nd open order');
select is(tests.err_detail(tests.order_sql(tests.id('cust'), tests.id('addr'))), 'OK', 'after first delivery: 3rd open order');
select is(tests.err_detail(tests.order_sql(tests.id('cust'), tests.id('addr'))), 'TOO_MANY_ACTIVE_ORDERS:3',
  'after first delivery the normal limit applies (3), detail = 3');

-- الإعداد: يعدّله الأدمن بالمدى المسموح، ومُدقَّق
select tests.as_user(tests.id('admin'));
select is((public.update_app_settings('{"new_account_max_active_orders": 2}'::jsonb)).new_account_max_active_orders, 2,
  'admin can change new_account_max_active_orders');
select throws_ok($$ select public.update_app_settings('{"new_account_max_active_orders": 0}'::jsonb) $$,
  'P0001', 'INVALID_SETTINGS', 'new_account_max_active_orders = 0 refused');
select throws_ok($$ select public.update_app_settings('{"new_account_max_active_orders": 1001}'::jsonb) $$,
  'P0001', 'INVALID_SETTINGS', 'new_account_max_active_orders = 1001 refused');
select tests.as_postgres();
select ok(exists (select 1 from public.admin_audit where action = 'settings'
                   and after ? 'new_account_max_active_orders' and (after ->> 'new_account_max_active_orders') = '2'),
  'the change is audited');
update public.app_settings set new_account_max_active_orders = 1000, max_active_orders = 1000;

-- ================================================================ H2: إلغاء كل الطلبات + تعطيل
select tests.remember('bad', tests.new_user('customer'));
select tests.remember('bad_drv', tests.new_user('driver'));
select tests.remember('o_pend', tests.order_in('pending', tests.id('bad')));
select tests.remember('o_prep', tests.order_in('preparing', tests.id('bad')));
select tests.remember('o_out',  tests.order_in('out_for_delivery', tests.id('bad'), tests.id('bad_drv')));
select tests.remember('o_done', tests.order_in('delivered', tests.id('bad')));
select tests.remember('other',  tests.new_user('customer'));
select tests.remember('o_other', tests.order_in('pending', tests.id('other')));
select tests.as_user(tests.id('bad'));
select public.register_push_token('ExponentPushToken[bad-1]', 'ios');
select tests.as_postgres();
create temp table lock_before on commit drop as
  select o.id as order_id, s.product_id, s.qty
    from public.orders o join public.order_items i on i.order_id = o.id join public.stock s on s.product_id = i.product_id
   where o.id in (tests.id('o_pend'), tests.id('o_prep'), tests.id('o_out'), tests.id('o_done'));
grant select on lock_before to authenticated;
insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), tests.id('bad'), now(), now());

select tests.as_user(tests.id('staff'));
select throws_ok(format($$ select public.admin_cancel_customer_orders(%L) $$, tests.id('bad')),
  '42501', 'NOT_ALLOWED', 'staff cannot cancel-all');
select tests.as_user(tests.id('bad'));
select throws_ok(format($$ select public.admin_cancel_customer_orders(%L) $$, tests.id('other')),
  '42501', 'NOT_ALLOWED', 'a customer cannot cancel-all');
select tests.as_user_aal1(tests.id('admin'));
select throws_ok(format($$ select public.admin_cancel_customer_orders(%L) $$, tests.id('bad')),
  '42501', 'NOT_ALLOWED', 'an admin on a PIN-only (aal1) session cannot cancel-all');
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.admin_cancel_customer_orders(%L) $$, tests.id('staff')),
  'P0001', 'NOT_A_CUSTOMER', 'target must be a customer (staff refused)');
select throws_ok(format($$ select public.admin_cancel_customer_orders(%L) $$, tests.id('bad_drv')),
  'P0001', 'NOT_A_CUSTOMER', 'target must be a customer (driver refused)');
select throws_ok(format($$ select public.admin_cancel_customer_orders(%L) $$, gen_random_uuid()),
  'P0001', 'USER_NOT_FOUND', 'unknown user');
-- T23 F L4: الطلب بالطريق لا يُلغى (يُرجَع رقمه ليقرر الأدمن)
select is(public.admin_cancel_customer_orders(tests.id('bad')),
  jsonb_build_object('cancelled', 2, 'out_for_delivery', 1,
    'out_for_delivery_numbers', jsonb_build_array((select order_number from public.orders where id = tests.id('o_out')))),
  'cancel-all: 2 open orders cancelled, the one out for delivery left and listed (T23 F L4)');

select tests.as_postgres();
select is((select count(*)::int from public.orders where customer_id = tests.id('bad') and status = 'cancelled'), 2,
  'the pending and preparing orders are cancelled');
select is((select status::text from public.orders where id = tests.id('o_done')), 'delivered',
  'a delivered order is untouched');
select is((select status::text from public.orders where id = tests.id('o_other')), 'pending',
  'another customer''s order is untouched');
select is((select s.qty - b.qty from public.stock s join lock_before b on b.product_id = s.product_id
            where b.order_id = tests.id('o_pend')), 1, 'pending order: stock returned');
select is((select s.qty - b.qty from public.stock s join lock_before b on b.product_id = s.product_id
            where b.order_id = tests.id('o_prep')), 1, 'preparing order: stock returned');
select is((select s.qty - b.qty from public.stock s join lock_before b on b.product_id = s.product_id
            where b.order_id = tests.id('o_out')), 0, 'out_for_delivery order: stock unchanged');
select is((select status::text from public.orders where id = tests.id('o_out')), 'out_for_delivery',
  'out_for_delivery order: left on the way, no waste booked (T23 F L4)');
select is((select is_active from public.profiles where id = tests.id('bad')), false, 'the customer is deactivated');
select is((select count(*)::int from auth.sessions where user_id = tests.id('bad')), 0, 'the customer''s sessions are revoked');
select is((select count(*)::int from public.push_tokens where user_id = tests.id('bad')), 0, 'push tokens are removed');
select ok(exists (select 1 from public.admin_audit where action = 'customer_lockdown' and target_id = tests.id('bad')
                   and actor = tests.id('admin') and (after ->> 'cancelled') = '2'
                   and jsonb_array_length(after -> 'left_out_for_delivery') = 1), 'audited as customer_lockdown with the counts');
select ok(exists (select 1 from public.admin_audit where action = 'user_role' and target_id = tests.id('bad')),
  'the deactivation is audited as user_role too');
select tests.as_user(tests.id('bad'));
select is(tests.err_detail(tests.order_sql(tests.id('bad'), (select id from public.addresses where customer_id = tests.id('bad') limit 1))),
  'NOT_CUSTOMER:', 'the deactivated customer cannot place orders');
select tests.as_user(tests.id('admin'));
select is(public.admin_cancel_customer_orders(tests.id('bad')) - 'out_for_delivery_numbers',
  '{"cancelled": 0, "out_for_delivery": 1}'::jsonb,
  'running it again is harmless (nothing more cancelled; the order on the way is still listed)');

-- ================================================================ M5: محو الهوية (الحالة الكاملة بـ 12_delete_account)
select tests.as_postgres();
select tests.remember('gone', tests.new_user('customer', 'اسم يُحذف'));
select tests.remember('o_gone', tests.order_in('delivered', tests.id('gone')));
select tests.remember('o_keep', tests.order_in('delivered', tests.id('other')));
select ok((select customer_name is not null and customer_phone is not null and address_snapshot ? 'building'
             from public.orders where id = tests.id('o_gone')), 'before deletion the order carries the identity');
delete from auth.users where id = tests.id('gone');
select ok((select customer_name is null and customer_phone is null and note is null and customer_id is null
             from public.orders where id = tests.id('o_gone')), 'after deletion: name, phone, note are gone');
select is((select address_snapshot ->> 'subsection' is not null and address_snapshot ->> 'sector' is not null
                  and not (address_snapshot ? 'building') and not (address_snapshot ? 'apartment')
             from public.orders where id = tests.id('o_gone')), true, 'after deletion: only sector and unit remain');
select ok((select customer_name is not null from public.orders where id = tests.id('o_keep')),
  'another customer''s order keeps its data');

-- ================================================================ M6: نافذة الموظف
select tests.remember('o_old_done', tests.order_in('delivered', tests.id('other')));
select tests.remember('o_new_done', tests.order_in('delivered', tests.id('other')));
select tests.remember('o_edge_in',  tests.order_in('delivered', tests.id('other')));
select tests.remember('o_edge_out', tests.order_in('delivered', tests.id('other')));
select tests.remember('o_old_open', tests.order_in('pending', tests.id('other')));
update public.orders set created_at = now() - interval '10 days' where id = tests.id('o_old_done');
update public.orders set created_at = now() - interval '2 days'  where id = tests.id('o_new_done');
update public.orders set created_at = now() - interval '40 days' where id = tests.id('o_old_open');
-- حد النافذة: بداية يوم بغداد قبل 6 أيام
update public.orders set created_at = ((public.baghdad_today() - 6)::timestamp at time zone 'Asia/Baghdad')
 where id = tests.id('o_edge_in');
update public.orders set created_at = ((public.baghdad_today() - 6)::timestamp at time zone 'Asia/Baghdad') - interval '1 second'
 where id = tests.id('o_edge_out');
select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.orders where id = tests.id('o_old_done')), 0,
  'staff cannot read a delivered order older than 7 days');
select is((select count(*)::int from public.orders where id = tests.id('o_new_done')), 1,
  'staff reads a delivered order from 2 days ago');
select is((select count(*)::int from public.orders where id = tests.id('o_old_open')), 1,
  'staff reads an OPEN order however old');
select is((select count(*)::int from public.orders where id = tests.id('o_edge_in')), 1,
  'staff reads an order at the start of the Baghdad day 6 days ago (7 calendar days)');
select is((select count(*)::int from public.orders where id = tests.id('o_edge_out')), 0,
  'staff cannot read an order one second before that');
select is((select count(*)::int from public.order_items where order_id = tests.id('o_old_done')), 0,
  'order_items of an old order are hidden too');
select is((select count(*)::int from public.order_status_history where order_id = tests.id('o_old_done')), 0,
  'order history of an old order is hidden too');
-- set_order_status (SECURITY DEFINER) لا يمر بـ RLS، لكن الطلب الخارج من النافذة منتهٍ دائماً (المفتوح داخلها دائماً)
-- فلا تحويل ممكن ولا يرجع صفاً: الرفض بلا بيانات
select is(tests.err_detail(format($$ select public.set_order_status(%L, 'cancelled') $$, tests.id('o_old_done'))),
  'INVALID_TRANSITION:delivered -> cancelled', 'an old (final) order cannot be changed by staff through the RPC either');
select tests.as_user(tests.id('admin'));
select is((select count(*)::int from public.orders where id in (tests.id('o_old_done'), tests.id('o_edge_out'))), 2,
  'admin reads every order');
select tests.as_user(tests.id('other'));
select is((select count(*)::int from public.orders where id = tests.id('o_old_done')), 1,
  'the customer still reads their own old order');
select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.orders where status = 'delivered'
             and created_at < ((public.baghdad_today() - 6)::timestamp at time zone 'Asia/Baghdad')), 0,
  'a staff-wide scan finds no final order outside the window');

-- ================================================================ M7: خمول جلسة اللوحة
select tests.as_postgres();
select tests.remember('sess1', gen_random_uuid());
select tests.remember('sess2', gen_random_uuid());
select tests.remember('sess_c', gen_random_uuid());
insert into auth.sessions (id, user_id, created_at, updated_at)
values (tests.id('sess1'), tests.id('staff'), now(), now()),
       (tests.id('sess2'), tests.id('staff'), now(), now()),
       (tests.id('sess_c'), tests.id('cust'), now(), now());

select tests.as_anon();
select throws_ok($$ select public.touch_panel_session() $$, '42501', null, 'anon cannot call touch_panel_session');
select tests.as_session(tests.id('staff'), tests.id('sess1'));
select is(public.touch_panel_session(), true, 'first touch: alive');
select tests.as_postgres();
select is((select count(*)::int from private.panel_sessions where session_id = tests.id('sess1')), 1,
  'the first touch creates the row');
select ok(not has_table_privilege('authenticated', 'private.panel_sessions', 'select'),
  'panel_sessions is not readable by authenticated');

-- نشاط حديث: الدور يعمل
select tests.as_session(tests.id('staff'), tests.id('sess1'));
select isnt(private.current_user_role(), null, 'active session: role works');
-- 11 ساعة بلا نشاط: ما زال حياً، واللمسة تجدد
select tests.as_postgres();
update private.panel_sessions set last_seen = now() - interval '11 hours' where session_id = tests.id('sess1');
select tests.as_session(tests.id('staff'), tests.id('sess1'));
select isnt(private.current_user_role(), null, '11 h idle: still alive');
select is(public.touch_panel_session(), true, '11 h idle: touch keeps it alive');
select tests.as_postgres();
select ok((select last_seen > now() - interval '1 minute' from private.panel_sessions where session_id = tests.id('sess1')),
  'the touch renewed last_seen');

-- 13 ساعة: الدور يسقط بالخادم (حتى بلا أي استدعاء من المتصفح)
update private.panel_sessions set last_seen = now() - interval '13 hours' where session_id = tests.id('sess1');
select tests.remember('o_staff_visible', tests.order_in('pending', tests.id('other')));
select tests.as_session(tests.id('staff'), tests.id('sess1'));
select is(private.current_user_role(), null, '13 h idle: no role (server enforced)');
select is((select count(*)::int from public.orders where id = tests.id('o_staff_visible')), 0,
  '13 h idle: RLS shows the staff session no orders');
select throws_ok($$ select public.dashboard_today() $$, '42501', null, '13 h idle: RPCs refuse (42501)');
-- جلسة أخرى لنفس المستخدم لا تتأثر
select tests.as_session(tests.id('staff'), tests.id('sess2'));
select isnt(private.current_user_role(), null, 'another session of the same user is unaffected');
-- اللمسة لا تُحيي جلسة منتهية: تحذفها
select tests.as_session(tests.id('staff'), tests.id('sess1'));
select is(public.touch_panel_session(), false, 'touching an expired session returns false');
select tests.as_postgres();
select is((select count(*)::int from auth.sessions where id = tests.id('sess1')), 0, 'the expired session is deleted from Auth');
select is((select count(*)::int from private.panel_sessions where session_id = tests.id('sess1')), 0,
  'its activity row goes with it');
select tests.as_session(tests.id('staff'), tests.id('sess1'));
select is(public.touch_panel_session(), false, 'a deleted session can never be revived by a touch');
-- جلسة بلا صف (سكربت/اختبار): لا قيد
select tests.as_session(tests.id('staff'), gen_random_uuid());
select isnt(private.current_user_role(), null, 'a session that never touched the panel is not restricted');
-- الزبون: لا تتبع
select tests.as_session(tests.id('cust'), tests.id('sess_c'));
select is(public.touch_panel_session(), true, 'customer: true, not tracked');
select tests.as_postgres();
select is((select count(*)::int from private.panel_sessions where session_id = tests.id('sess_c')), 0, 'customer: no activity row');
-- حذف الجلسة من Auth يحذف الصف
select tests.as_postgres();
delete from auth.sessions where id = tests.id('sess2');
select is((select count(*)::int from private.panel_sessions where session_id = tests.id('sess2')), 0, 'row cascades with the Auth session');

-- ================================================================ L2: رموز الإشعارات
select tests.as_user(tests.id('drv'));
select public.register_push_token('ExponentPushToken[l2-' || n || ']', 'ios') from generate_series(1, 7) n;
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id = tests.id('drv')), 5, 'at most 5 tokens per user');
select ok(not exists (select 1 from public.push_tokens where token in ('ExponentPushToken[l2-1]', 'ExponentPushToken[l2-2]'))
          and exists (select 1 from public.push_tokens where token = 'ExponentPushToken[l2-7]'),
  'the oldest tokens are the ones dropped');
select tests.as_user(tests.id('cust'));
select public.register_push_token('ExponentPushToken[l2-c]', 'ios');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id = tests.id('cust')), 1,
  'another user''s tokens are not touched by the cap');
update public.push_tokens set last_seen_at = now() - interval '61 days' where token = 'ExponentPushToken[l2-c]';
select private.purge_push_history();
select is((select count(*)::int from public.push_tokens where token = 'ExponentPushToken[l2-c]'), 0,
  'the daily purge removes tokens not seen for 60 days');
select ok(exists (select 1 from public.push_tokens where token = 'ExponentPushToken[l2-7]'), 'fresh tokens stay');

-- ================================================================ L3: تنظيف النص وحد العناوين
select tests.as_postgres();
update public.profiles set full_name = E'علي‮خفي​  ' where id = tests.id('cust');
select is((select full_name from public.profiles where id = tests.id('cust')), 'عليخفي', 'profile name: bidi and zero-width removed');
update public.profiles set full_name = E'سطر1\nسطر2' where id = tests.id('cust');
select is((select full_name from public.profiles where id = tests.id('cust')), 'سطر1 سطر2', 'profile name stays single-line');
select is(private.clean_user_text(E'a\u0007b c⁦d﻿'), 'abcd', 'control, line separator, isolates and BOM are removed');
select is(private.clean_user_text(E'ملاحظة\r\nثانية'), E'ملاحظة\nثانية', 'CRLF becomes LF in multi-line text');
select is(private.clean_user_text('   '), null, 'blank text becomes null');
select is(private.clean_user_text('مرحبا 123 abc ٣', true), 'مرحبا 123 abc ٣', 'normal Arabic and digits are untouched');

update public.addresses set apartment = E'5‮', note = E'بجانب​ الباب', label = E'بيتي\nالجديد'
 where id = tests.id('addr');
select is((select apartment || '|' || note || '|' || label from public.addresses where id = tests.id('addr')),
  '5|بجانب الباب|بيتي الجديد', 'address text is cleaned');
select throws_ok(format($$ update public.addresses set apartment = E'​' where id = %L $$, tests.id('addr')),
  '23514', null, 'an apartment empty after cleaning is refused by the table check');

select tests.as_user(tests.id('cust'));
select is(tests.err_detail(format($$ select public.place_order(%L, %L::jsonb, %L, E'عاجل‮​') $$, tests.id('addr'),
  jsonb_build_array(tests.item(tests.id('p'), 1)), gen_random_uuid())), 'OK', 'order with a dirty note');
select tests.as_postgres();
select is((select note from public.orders where customer_id = tests.id('cust') order by order_number desc limit 1), 'عاجل',
  'the order note is cleaned');

-- حد 20 عنواناً لكل زبون
select tests.remember('cust20', tests.new_user('customer'));
select set_config('t.bld', (select building_id::text from public.addresses where id = tests.id('addr')), true);
insert into public.addresses (customer_id, building_id, apartment)
select tests.id('cust20'), current_setting('t.bld')::int, n::text from generate_series(1, 20) n;
select is((select count(*)::int from public.addresses where customer_id = tests.id('cust20')), 20, '20 addresses are allowed');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, apartment) values (%L, %s, '21') $$,
  tests.id('cust20'), current_setting('t.bld')), 'P0001', 'ADDRESS_LIMIT', 'the 21st address is refused (ADDRESS_LIMIT)');
select lives_ok(format($$ insert into public.addresses (customer_id, building_id, apartment) values (%L, %s, '1') $$,
  tests.id('other'), current_setting('t.bld')), 'the limit is per customer');
select is(tests.err_detail(format($$ insert into public.addresses (customer_id, building_id, apartment) values (%L, %s, '22') $$,
  tests.id('cust20'), current_setting('t.bld'))), 'ADDRESS_LIMIT:20', 'ADDRESS_LIMIT carries the limit as detail');

select * from finish();
