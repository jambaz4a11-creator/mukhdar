-- 22: مراجعة T16-T19، جلسة الإصلاح B (migration 20261124000001):
--   M4 record_pin_reset(kind) | L3 admin_rate_hit | M5 الإشعارات العالقة/الفاشلة/المصروفة | M7 صيغة العمارة،
--   صلاحيات جداول العناوين، address_usage.
select plan(50);

select tests.remember('admin',    tests.new_user('admin'));
select tests.remember('admin_bg', tests.new_user('admin'));   -- هدف الطوارئ (تُضبط عليه must_change_pin)
select tests.remember('staff',    tests.new_user('staff'));
select tests.remember('cust',     tests.new_user('customer'));

-- ================================================================ 1) M4: pin_resets.kind
select tests.as_service();
select lives_ok(format($$ select public.record_pin_reset(%L, %L) $$, tests.id('cust'), tests.id('admin')),
  'record_pin_reset keeps working with two arguments (deployed admin-reset-pin)');
select lives_ok(format($$ select public.record_pin_reset(%L, null, 'break_glass') $$, tests.id('admin_bg')),
  'record_pin_reset(break_glass) with no reset_by (owner script)');
select throws_ok(format($$ select public.record_pin_reset(%L, null, 'whatever') $$, tests.id('admin_bg')),
  'P0001', 'INVALID_REQUEST', 'unknown kind refused');
select tests.as_postgres();
select is((select kind from public.pin_resets where user_id = tests.id('cust')), 'admin', 'default kind = admin');
select is((select count(*)::int from public.pin_resets
            where user_id = tests.id('admin_bg') and reset_by is null and kind = 'break_glass'), 1,
  'break-glass row: no reset_by, kind = break_glass');
select is((select must_change_pin from public.profiles where id = tests.id('admin_bg')), true,
  'break-glass sets must_change_pin');
select throws_ok($$ insert into public.pin_resets (kind) values ('x') $$, '23514', null, 'kind check constraint');
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.record_pin_reset(%L, null, 'break_glass') $$, tests.id('cust')),
  '42501', null, 'record_pin_reset is not callable by authenticated (even an admin)');
select tests.as_postgres();

-- ================================================================ 2) L3: حد المعدل يحسب كل المحاولات
select tests.as_service();
select is(public.admin_rate_hit('pin_reset', tests.id('admin')), 1, 'first attempt counts 1');
select is(public.admin_rate_hit('pin_reset', tests.id('admin')), 2, 'a second attempt (even one that would fail later) counts 2');
select is(public.admin_rate_hit('user_creation', tests.id('admin')), 1, 'kinds are counted separately');
select is(public.admin_rate_hit('pin_reset', tests.id('staff')), 1, 'admins are counted separately');
select throws_ok($$ select public.admin_rate_hit('other', gen_random_uuid()) $$, 'P0001', 'INVALID_REQUEST', 'unknown kind refused');
select tests.as_postgres();
update public.admin_function_hits set created_at = now() - interval '2 hours'
 where kind = 'pin_reset' and admin_id = tests.id('admin');
select tests.as_service();
select is(public.admin_rate_hit('pin_reset', tests.id('admin')), 1, 'attempts older than an hour stop counting');
select tests.as_postgres();
select tests.as_user(tests.id('admin'));
select throws_ok($$ select public.admin_rate_hit('pin_reset', gen_random_uuid()) $$, '42501', null,
  'admin_rate_hit is service_role only');
select throws_ok($$ select count(*) from public.admin_function_hits $$, '42501', null, 'hits table is not readable by the app');
select tests.as_postgres();

-- ================================================================ 3) M5: الإشعارات
delete from public.notification_outbox where sent_at is null;   -- نظيف داخل المعاملة (تُلغى)
insert into public.notification_outbox (audience, title, body, created_at, attempts) values
  ('admins', 'retryable-old', 'x', now() - interval '10 minutes', 2),   -- عالق
  ('admins', 'fresh',         'x', now() - interval '1 minute', 0),     -- جديد: لا
  ('admins', 'dead-1',        'x', now() - interval '3 hours',  5),     -- فاشل نهائياً
  ('admins', 'dead-2',        'x', now() - interval '2 hours',  5);
insert into public.notification_outbox (audience, title, body, created_at, attempts, sent_at) values
  ('admins', 'sent', 'x', now() - interval '1 hour', 0, now());

select tests.as_user(tests.id('admin'));
select is(public.stuck_notifications_count(), 1, 'stuck = only the retryable old one (dead rows do not keep it red)');
select is(public.failed_notifications_count(), 2, 'failed = the two exhausted rows');
select is(public.dismiss_failed_notifications(), 2, 'dismiss returns how many were cleared');
select is(public.failed_notifications_count(), 0, 'failed count clears after dismissal');
select is(public.stuck_notifications_count(), 1, 'dismissal does not touch the stuck (retryable) one');
select is(public.dismiss_failed_notifications(), 0, 'dismissing again clears nothing');
select tests.as_postgres();
select is((select count(*)::int from public.admin_audit where action = 'notifications_dismissed'), 1,
  'dismissal is audited once (the empty second call writes nothing)');
select is((select (after ->> 'count')::int from public.admin_audit where action = 'notifications_dismissed'), 2,
  'audit row records how many');
select is((select count(*)::int from public.notification_outbox where dismissed_at is not null), 2,
  'the rows are kept (dismissed_at), not deleted');
-- الصف الميت يعود يُحسب إن لم يُصرف؟ لا: بعد الصرف جديد يفشل نهائياً يُحسب من جديد
insert into public.notification_outbox (audience, title, body, attempts) values ('admins', 'dead-3', 'x', 5);
select tests.as_user(tests.id('admin'));
select is(public.failed_notifications_count(), 1, 'a new permanent failure after dismissal is counted again');
select tests.as_user(tests.id('staff'));
select throws_ok($$ select public.stuck_notifications_count() $$, '42501', 'NOT_ALLOWED', 'staff: no stuck count');
select throws_ok($$ select public.failed_notifications_count() $$, '42501', 'NOT_ALLOWED', 'staff: no failed count');
select throws_ok($$ select public.dismiss_failed_notifications() $$, '42501', 'NOT_ALLOWED', 'staff: cannot dismiss');
select tests.as_postgres();

-- ================================================================ 4) M7: العناوين
with s as (insert into public.sectors (name) values ('test-sector B') returning id)
select set_config('t.sec', id::text, true) from s;
with u as (insert into public.subsections (sector_id, name)
           values (current_setting('t.sec')::int, 'B1') returning id)
select set_config('t.sub', id::text, true) from u;
with u as (insert into public.subsections (sector_id, name)
           values (current_setting('t.sec')::int, 'B2') returning id)
select set_config('t.sub2', id::text, true) from u;

-- صيغة العمارة 1..100 بقاعدة البيانات
select lives_ok(format($$ insert into public.buildings (subsection_id, number) values (%s, '1'), (%s, '100'), (%s, '57') $$,
  current_setting('t.sub'), current_setting('t.sub'), current_setting('t.sub')), 'buildings 1, 57, 100 accepted');
select throws_ok(format($$ insert into public.buildings (subsection_id, number) values (%s, '0') $$, current_setting('t.sub')),
  '23514', null, 'building 0 refused');
select throws_ok(format($$ insert into public.buildings (subsection_id, number) values (%s, '101') $$, current_setting('t.sub')),
  '23514', null, 'building 101 refused');
select throws_ok(format($$ insert into public.buildings (subsection_id, number) values (%s, '012') $$, current_setting('t.sub')),
  '23514', null, 'leading zero refused');
select throws_ok(format($$ insert into public.buildings (subsection_id, number) values (%s, '12أ') $$, current_setting('t.sub')),
  '23514', null, 'letters refused');
select throws_ok(format($$ insert into public.buildings (subsection_id, number) values (%s, '1.5') $$, current_setting('t.sub')),
  '23514', null, 'decimals refused');

select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.add_buildings(%s, array['101']) $$, current_setting('t.sub2')),
  'P0001', 'INVALID_BUILDINGS', 'add_buildings: 101 refused');
select is(public.add_buildings(current_setting('t.sub2')::int, array['1', '2', '100']), 3, 'add_buildings: 1, 2, 100 accepted');
-- الأعمدة المسموح تعديلها: الرقم والإخفاء والترتيب فقط
select is(tests.affected(format($$ update public.buildings set number = '58' where subsection_id = %s and number = '57' $$,
  current_setting('t.sub'))), 1, 'admin can rename a building number');
select throws_ok(format($$ update public.buildings set subsection_id = %s where subsection_id = %s and number = '1' $$,
  current_setting('t.sub2'), current_setting('t.sub')), '42501', null, 'admin cannot move a building to another unit');
select throws_ok(format($$ update public.subsections set sector_id = sector_id where id = %s $$, current_setting('t.sub')),
  '42501', null, 'admin cannot change a unit''s sector');
select throws_ok(format($$ delete from public.buildings where subsection_id = %s $$, current_setting('t.sub')),
  '42501', null, 'admin cannot delete buildings (hide instead)');
select throws_ok(format($$ delete from public.subsections where id = %s $$, current_setting('t.sub')),
  '42501', null, 'admin cannot delete units');
select throws_ok(format($$ delete from public.sectors where id = %s $$, current_setting('t.sec')),
  '42501', null, 'admin cannot delete sectors');
select tests.as_postgres();

-- address_usage: عدد العناوين المحفوظة المتأثرة
select set_config('t.b1', (select id::text from public.buildings where subsection_id = current_setting('t.sub')::int and number = '1'), true);
select set_config('t.b2', (select id::text from public.buildings where subsection_id = current_setting('t.sub2')::int and number = '1'), true);
insert into public.addresses (customer_id, building_id, apartment) values
  (tests.id('cust'), current_setting('t.b1')::int, '1'),
  (tests.id('cust'), current_setting('t.b1')::int, '2'),
  (tests.id('cust'), current_setting('t.b2')::int, '3');
select tests.as_user(tests.id('admin'));
select is(public.address_usage('buildings', current_setting('t.b1')::int), 2, 'address_usage(building) = 2');
select is(public.address_usage('buildings', current_setting('t.b2')::int), 1, 'address_usage(other building) = 1');
select is(public.address_usage('subsections', current_setting('t.sub')::int), 2, 'address_usage(unit B1) = 2');
select is(public.address_usage('sectors', current_setting('t.sec')::int), 3, 'address_usage(sector) = 3 (both units)');
select is(public.address_usage('buildings', 2147483000), 0, 'unknown id = 0');
select throws_ok($$ select public.address_usage('products', 1) $$, 'P0001', 'INVALID_REQUEST', 'unknown kind refused');
select tests.as_user(tests.id('staff'));
select throws_ok($$ select public.address_usage('buildings', 1) $$, '42501', 'NOT_ALLOWED', 'staff cannot call address_usage');
select tests.as_postgres();

select * from finish();
