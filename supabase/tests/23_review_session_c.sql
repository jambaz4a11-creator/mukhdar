-- 23: مراجعة جلسة الإصلاح AB، جلسة C (migration 20261125000001):
--   H1 الإشعارات لا تصل للمعلَّم (must_change_pin) وتُحذف الرموز بالإعادة/التعطيل/التخفيض
--   M1 accept_order/assign_driver (القفل بالدور والعلامة، DRIVER_PIN_PENDING، list_drivers)
--   L2 admin_actions_last_hour محذوفة | L3 نفس السائق | L4(b) كلفة الهدر | L5 kind/reset_by
select plan(54);

select tests.remember('admin',  tests.new_user('admin'));
select tests.remember('staff',  tests.new_user('staff'));
select tests.remember('staff2', tests.new_user('staff'));
select tests.remember('d1',     tests.new_user('driver'));
select tests.remember('d2',     tests.new_user('driver'));
select tests.remember('d3',     tests.new_user('driver'));
select tests.remember('cust',   tests.new_user('customer'));

-- T23 F H1: رموز الأدمن/الموظف مربوطة بجلسة aal2
insert into public.push_tokens (user_id, token, platform, provider, session_id) values
  (tests.id('admin'),  'ExponentPushToken[c-admin]',  'ios',     'expo', tests.panel_session(tests.id('admin'))),
  (tests.id('staff'),  'ExponentPushToken[c-staff]',  'ios',     'expo', tests.panel_session(tests.id('staff'))),
  (tests.id('staff2'), 'ExponentPushToken[c-staff2]', 'ios',     'expo', tests.panel_session(tests.id('staff2'))),
  (tests.id('d1'),     'ExponentPushToken[c-d1]',     'android', 'expo', null),
  (tests.id('d2'),     'ExponentPushToken[c-d2]',     'android', 'expo', null),
  (tests.id('cust'),   'ExponentPushToken[c-cust]',   'android', 'expo', null);

-- ================================================================ 1) H1: المستلمون
-- staff2 و d2 و cust معلَّمون بالرمز المؤقت: لا يصلهم شيء مهما كان الجمهور
update public.profiles set must_change_pin = true
 where id in (tests.id('staff2'), tests.id('d2'), tests.id('cust'));

insert into public.notification_outbox (audience, user_id, title, body) values
  ('admins',      null,               'C-admins',      'b'),
  ('admins_only', null,               'C-admins-only', 'b'),
  ('drivers',     null,               'C-drivers',     'b'),
  ('user',        tests.id('cust'),   'C-cust',        'b'),
  ('user',        tests.id('d2'),     'C-d2',          'b'),
  ('user',        tests.id('staff'),  'C-staff',       'b');

create temp table claimed (id bigint, title text, body text, data jsonb, attempts int, recipients jsonb);
grant all on claimed to service_role;
select tests.as_service();
insert into claimed select * from public.claim_push_notifications(50);
select tests.as_postgres();

select is((select jsonb_path_query_array(recipients, '$[*].token') from claimed where title = 'C-admins'),
  '["ExponentPushToken[c-admin]", "ExponentPushToken[c-staff]"]'::jsonb,
  'admins audience: flagged staff2 gets nothing');
-- رموز هذا الملف فقط (Expo): mukhdar-dev قد يحوي اشتراك ويب حقيقياً لسائق تجريبي (R3)
select is((select jsonb_path_query_array(recipients, '$[*] ? (@.token starts with "Expo").token') from claimed where title = 'C-drivers'),
  '["ExponentPushToken[c-d1]"]'::jsonb, 'drivers audience: flagged driver d2 gets nothing');
select is((select recipients from claimed where title = 'C-cust'), '[]'::jsonb,
  'user audience: a flagged customer gets nothing');
select is((select recipients from claimed where title = 'C-d2'), '[]'::jsonb,
  'user audience (assignment push): a flagged driver gets nothing');
select is((select jsonb_path_query_array(recipients, '$[*].token') from claimed where title = 'C-staff'),
  '["ExponentPushToken[c-staff]"]'::jsonb, 'an unflagged user still receives their own push');
select is((select jsonb_path_query_array(recipients, '$[*].token') from claimed where title = 'C-admins-only'),
  '["ExponentPushToken[c-admin]"]'::jsonb, 'admins_only unchanged');

-- clearing the flag restores delivery (the trigger path is exercised in it:admin-users on the cloud)
update public.profiles set must_change_pin = false where id = tests.id('d2');
insert into public.notification_outbox (audience, user_id, title, body) values ('user', tests.id('d2'), 'C-d2-again', 'b');
select tests.as_service();
select is((select jsonb_path_query_array(recipients, '$[*].token') from public.claim_push_notifications(50) where title = 'C-d2-again'),
  '["ExponentPushToken[c-d2]"]'::jsonb, 'after the PIN change the driver receives pushes again');
select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('d2');

-- ================================================================ 2) H1: register_push_token
select tests.as_user(tests.id('staff2'));
select throws_ok($$ select public.register_push_token('ExponentPushToken[c-new]', 'ios', 'expo') $$,
  '42501', 'PIN_CHANGE_REQUIRED', 'a flagged user cannot register a push token');
select tests.as_user(tests.id('cust'));
select throws_ok($$ select public.register_push_token('ExponentPushToken[c-new]', 'ios', 'expo') $$,
  '42501', 'PIN_CHANGE_REQUIRED', 'also a flagged customer (registers again after changing the PIN)');
select tests.as_panel(tests.id('staff'));
select lives_ok($$ select public.register_push_token('ExponentPushToken[c-staff-b]', 'ios', 'expo') $$,
  'an unflagged user still registers');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id = tests.id('staff2')), 1,
  'the flagged user token count is unchanged by the refused call');

-- ================================================================ 3) H1: إعادة الضبط والتعطيل والتخفيض تحذف الرموز
update public.profiles set must_change_pin = false where id = tests.id('d1');
select tests.as_service();
select lives_ok(format($$ select public.record_pin_reset(%L, %L) $$, tests.id('d1'), tests.id('admin')),
  'admin PIN reset');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id = tests.id('d1')), 0,
  'PIN reset deletes the user push tokens');
select is((select must_change_pin from public.profiles where id = tests.id('d1')), true, 'and flags the profile');
select is((select count(*)::int from public.push_tokens where user_id = tests.id('staff')), 2,
  'other users keep their tokens');

-- تعطيل موظف: يُحذف رمزه (جلسته أُبطلت بالمرحلة A)
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'staff', false) $$, tests.id('staff')), 'admin deactivates staff');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id = tests.id('staff')), 0,
  'deactivation deletes push tokens');

-- تخفيض سائق: يُحذف رمزه
insert into public.push_tokens (user_id, token, platform, provider)
values (tests.id('d3'), 'ExponentPushToken[c-d3]', 'android', 'expo');
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'customer', true) $$, tests.id('d3')), 'admin demotes a driver');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id = tests.id('d3')), 0,
  'demotion deletes push tokens');

-- ترقية (T23 F M2): تتطلب رمزاً مؤقتاً أولاً، وتحذف رموز الإشعارات (تُسجَّل من جديد بجلسة اللوحة aal2)
insert into public.push_tokens (user_id, token, platform, provider)
values (tests.id('d3'), 'ExponentPushToken[c-d3b]', 'android', 'expo');
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.set_user_role(%L, 'staff', true) $$, tests.id('d3')),
  'P0001', 'PIN_RESET_REQUIRED', 'promoting a customer without a temporary PIN is refused (T23 F M2)');
select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('d3');
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'staff', true) $$, tests.id('d3')), 'admin promotes customer → staff');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id = tests.id('d3')), 0,
  'a promotion drops the old push tokens (T23 F H1/M2)');

-- ================================================================ 4) L5: kind ↔ reset_by
select tests.as_service();
select throws_ok(format($$ select public.record_pin_reset(%L, null, 'admin') $$, tests.id('cust')),
  'P0001', 'INVALID_REQUEST', 'kind admin requires reset_by');
select throws_ok(format($$ select public.record_pin_reset(%L, %L, 'break_glass') $$, tests.id('cust'), tests.id('admin')),
  'P0001', 'INVALID_REQUEST', 'kind break_glass must not carry reset_by');
select lives_ok(format($$ select public.record_pin_reset(%L, null, 'break_glass') $$, tests.id('cust')),
  'break_glass without reset_by is fine');
select tests.as_postgres();

-- ================================================================ 5) L2
select hasnt_function('public', 'admin_actions_last_hour', 'admin_actions_last_hour is dropped');

-- ================================================================ 6) M1: assign_driver / list_drivers
update public.profiles set must_change_pin = false where id in (tests.id('d1'), tests.id('d2'));
update public.profiles set must_change_pin = true  where id = tests.id('d2');
select tests.remember('o_prep', tests.order_in('preparing', null, tests.id('d1')));

select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_prep'), tests.id('d2')),
  'P0001', 'DRIVER_PIN_PENDING', 'a driver who has not changed the temporary PIN cannot be assigned');
select is((select driver_id from public.orders where id = tests.id('o_prep')), tests.id('d1'),
  'the order stays with its driver');
select is((select must_change_pin from public.list_drivers() where id = tests.id('d2')), true,
  'list_drivers returns must_change_pin (flagged)');
select is((select must_change_pin from public.list_drivers() where id = tests.id('d1')), false,
  'list_drivers returns must_change_pin (not flagged)');
select tests.as_postgres();

-- L3: نفس السائق = بلا سجل ولا إشعار
select is((select count(*)::int from public.order_status_history where order_id = tests.id('o_prep')
            and note in ('driver_assigned', 'driver_reassigned')), 1, 'baseline: one driver_assigned row');
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_prep'), tests.id('d1')),
  'assigning the same driver again is accepted');
select tests.as_postgres();
select is((select count(*)::int from public.order_status_history where order_id = tests.id('o_prep')
            and note in ('driver_assigned', 'driver_reassigned')), 1, 'same driver: no new history row');
select is((select count(*)::int from public.notification_outbox where user_id = tests.id('d1')
            and data ->> 'order_id' = tests.id('o_prep')::text and data ->> 'type' = 'assigned'), 1,
  'same driver: no second assignment push');
select is((select count(*)::int from public.admin_audit where action = 'order_driver' and target_id = tests.id('o_prep')), 0,
  'same driver: no audit row');

-- ================================================================ 7) M1: accept_order
select tests.remember('o_ready', tests.order_in('ready'));
select tests.as_user(tests.id('d2'));
select throws_ok(format($$ select public.accept_order(%L) $$, tests.id('o_ready')), '42501', 'NOT_ALLOWED',
  'a flagged driver cannot accept');
select tests.as_postgres();
select is((select driver_id from public.orders where id = tests.id('o_ready')), null, 'the order is untouched');

-- الدور يُفحص تحت القفل نفسه (حالة السباق أثناء الانتظار تُغطيها db:concurrency)
select matches(pg_get_functiondef('public.accept_order(uuid)'::regprocedure),
  'role = ''driver'' and is_active and not must_change_pin for share',
  'accept_order re-checks role, active and the flag in the lock predicate');

-- سائق ملغى الدور (بالسباق يظهر كخفض أثناء الانتظار): القفل يرفضه
update public.profiles set must_change_pin = false where id = tests.id('d2');
select tests.as_user(tests.id('d2'));
select lives_ok(format($$ select public.accept_order(%L) $$, tests.id('o_ready')), 'an unflagged active driver accepts');
select tests.as_postgres();
select is((select driver_id from public.orders where id = tests.id('o_ready')), tests.id('d2'), 'and gets the order');

-- ================================================================ 8) L4(b): بند بلا سجل كلفة
select tests.remember('o_nocost', tests.order_in('out_for_delivery', null, tests.id('d1')));
delete from public.order_item_costs
 where order_item_id in (select id from public.order_items where order_id = tests.id('o_nocost'));
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled', 'x', false) $$, tests.id('o_nocost')),
  'cancel without return when an item has no cost row');
select tests.as_postgres();
select is((select unit_cost_iqd from public.inventory_movements where order_id = tests.id('o_nocost') and type = 'waste'),
  0::bigint, 'the waste is valued at 0, not at today''s cost');
select is((select qty from public.inventory_movements where order_id = tests.id('o_nocost') and type = 'waste'),
  -1, 'the waste quantity is still recorded');

-- ================================================================ 9) L8(ب): تدقيق العناوين (migration 20261125000002)
create temp table adr as
  select sec.id as sector, sub.id as sub, 0 as bld
    from public.sectors sec join public.subsections sub on sub.sector_id = sec.id
   order by sec.id, sub.id limit 1;
-- عمارة جديدة بوحدة اختبار خاصة (أرقام 1..100 بالوحدات الحقيقية محجوزة، فلا مكان لرقم جديد فيها)
with u as (insert into public.subsections (sector_id, name) select sector, 'T23' from adr returning id),
     b as (insert into public.buildings (subsection_id, number) select id, '5' from u returning id)
update adr set bld = (select id from b);
grant select on adr to authenticated;
delete from public.admin_audit where action = 'address';

select tests.as_user(tests.id('admin'));
select lives_ok(format($$ update public.sectors set name = name || ' x' where id = %L $$, (select sector from adr)),
  'admin renames a sector');
select lives_ok(format($$ update public.subsections set is_active = false where id = %L $$, (select sub from adr)),
  'admin hides a unit');
select lives_ok(format($$ update public.buildings set number = '6', is_active = false where id = %L $$, (select bld from adr)),
  'admin renames and hides a building');
select lives_ok(format($$ update public.buildings set sort_order = sort_order + 1 where id = %L $$, (select bld from adr)),
  'admin only reorders');

select is((select count(*)::int from public.admin_audit where action = 'address'), 3,
  'three audit rows; a pure reorder is not audited');
select is((select after ->> 'name' from public.admin_audit where action = 'address' and after ->> 'table' = 'sectors'),
  (select name from public.sectors where id = (select sector from adr)), 'sector: new name recorded');
select isnt((select before ->> 'name' from public.admin_audit where action = 'address' and after ->> 'table' = 'sectors'),
  (select after ->> 'name' from public.admin_audit where action = 'address' and after ->> 'table' = 'sectors'),
  'sector: old name recorded');
select is((select (before ->> 'is_active') || '>' || (after ->> 'is_active') from public.admin_audit
            where action = 'address' and after ->> 'table' = 'subsections'), 'true>false', 'unit: hidden recorded');
select is((select after ->> 'number' from public.admin_audit where action = 'address' and after ->> 'table' = 'buildings'),
  '6', 'building: new number recorded');
select is((select count(*)::int from public.admin_audit where action = 'address' and actor = tests.id('admin')), 3,
  'the actor is the admin');
select tests.as_postgres();
select tests.remember('staff3', tests.new_user('staff'));
select tests.as_user(tests.id('staff3'));
select is((select count(*)::int from public.admin_audit), 0, 'staff cannot read the audit table');
select tests.as_postgres();

select * from finish();
