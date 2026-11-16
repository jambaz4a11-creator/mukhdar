-- 19: T19 (migration 20261122000001): update_app_settings، مؤشر الإشعارات العالقة، تدقيق pin_resets
-- وuser_creations (RLS)، دوال service_role للدالتين، وadd_buildings.
select plan(53);

select tests.remember('admin',    tests.new_user('admin'));
select tests.remember('staff',    tests.new_user('staff'));
select tests.remember('customer', tests.new_user('customer'));
select tests.remember('driver',   tests.new_user('driver'));
update public.app_settings
   set delivery_fee_iqd = 1000, min_order_iqd = 0, max_active_orders = 3, store_open = true, closed_message = null;

-- ---------------------------------------------------------------- update_app_settings: الصلاحية
select tests.as_user(tests.id('staff'));
select is(tests.try($$ select public.update_app_settings('{"store_open": false}') $$), 'NOT_ALLOWED',
  'staff cannot update settings');
select tests.as_user(tests.id('customer'));
select is(tests.try($$ select public.update_app_settings('{"store_open": false}') $$), 'NOT_ALLOWED',
  'customer cannot update settings');
select tests.as_anon();
select throws_ok($$ select public.update_app_settings('{"store_open": false}') $$, '42501', null,
  'anon cannot call update_app_settings');

-- ---------------------------------------------------------------- لا update مباشر
select tests.as_user(tests.id('admin'));
select throws_ok($$ update public.app_settings set store_open = false $$, '42501', null,
  'even the admin cannot update app_settings directly');
select ok(not has_table_privilege('authenticated', 'public.app_settings', 'update'),
  'authenticated has no update grant on app_settings');
select ok(not has_column_privilege('authenticated', 'public.app_settings', 'min_order_iqd', 'update'),
  'no column update grant on app_settings.min_order_iqd');

-- ---------------------------------------------------------------- update_app_settings: الأدمن
select is(
  (select row(delivery_fee_iqd, min_order_iqd, max_active_orders, store_open, closed_message)::text
     from public.update_app_settings(
       '{"delivery_fee_iqd": 1500, "min_order_iqd": 5000, "max_active_orders": 2, "store_open": false, "closed_message": "  نرجع الساعة 8  "}')),
  '(1500,5000,2,f,"نرجع الساعة 8")', 'admin saves all fields (message trimmed)');
select is((select min_order_iqd from public.app_settings), 5000::bigint, 'value persisted');
select is((select row(delivery_fee_iqd, store_open)::text from public.update_app_settings('{"store_open": true}')),
  '(1500,t)', 'partial update keeps the other fields');
select is((select closed_message from public.update_app_settings('{"closed_message": "   "}')), null,
  'a blank closed message is stored as null');

select is(tests.try($$ select public.update_app_settings('{"min_order_iqd": 1100}') $$), 'INVALID_SETTINGS',
  'min order 1100 is rejected (multiple of 250)');
select is(tests.try($$ select public.update_app_settings('{"delivery_fee_iqd": 900}') $$), 'INVALID_SETTINGS',
  'delivery fee 900 is rejected');
select is(tests.try($$ select public.update_app_settings('{"delivery_fee_iqd": -250}') $$), 'INVALID_SETTINGS',
  'negative fee is rejected');
select is(tests.try($$ select public.update_app_settings('{"delivery_fee_iqd": 1250.5}') $$), 'INVALID_SETTINGS',
  'fractional amount is rejected');
select is(tests.try($$ select public.update_app_settings('{"delivery_fee_iqd": "1000"}') $$), 'INVALID_SETTINGS',
  'amount as a string is rejected');
select is(tests.try($$ select public.update_app_settings('{"max_active_orders": 0}') $$), 'INVALID_SETTINGS',
  'max active orders 0 is rejected');
select is(tests.try($$ select public.update_app_settings('{"store_open": "yes"}') $$), 'INVALID_SETTINGS',
  'store_open must be boolean');
select is(tests.try(format($$ select public.update_app_settings(%L) $$,
    jsonb_build_object('closed_message', repeat('x', 201)))), 'INVALID_SETTINGS',
  'closed message over 200 chars is rejected');
select is(tests.try($$ select public.update_app_settings('{"id": 2}') $$), 'INVALID_SETTINGS',
  'unknown keys are rejected');
select is(tests.try($$ select public.update_app_settings('[]') $$), 'INVALID_SETTINGS',
  'non-object body is rejected');
select is((select min_order_iqd from public.app_settings), 5000::bigint, 'rejected updates change nothing');

select tests.as_postgres();
select throws_ok($$ update public.app_settings set min_order_iqd = 1100 $$, '23514', null,
  'database check: min_order_iqd % 250 = 0 (app_settings_min_order_multiple_250)');

-- ---------------------------------------------------------------- الإشعارات العالقة
select tests.as_postgres();
create temp table t_stuck_before as
  select count(*)::int as n from public.notification_outbox
   where sent_at is null and created_at < now() - interval '5 minutes';
grant select on t_stuck_before to authenticated;
insert into public.notification_outbox (audience, title, body, created_at) values
  ('admins', 't', 'old unsent', now() - interval '10 minutes'),
  ('admins', 't', 'new unsent', now()),
  ('admins', 't', 'old sent',   now() - interval '10 minutes');
update public.notification_outbox set sent_at = now() where body = 'old sent';
select tests.as_user(tests.id('admin'));
select is(public.stuck_notifications_count(), (select n + 1 from t_stuck_before),
  'stuck = unsent and older than 5 minutes');
select tests.as_user(tests.id('staff'));
select is(tests.try($$ select public.stuck_notifications_count() $$), 'NOT_ALLOWED',
  'staff cannot read the stuck count');

-- ---------------------------------------------------------------- service_role helpers: الصلاحيات
select tests.as_postgres();
select ok(has_function_privilege('service_role', 'public.record_pin_reset(uuid, uuid, text)', 'execute')
      and has_function_privilege('service_role', 'public.finish_user_creation(uuid, uuid, public.user_role, text)', 'execute'),
  'service_role can call the three helper functions');
select ok(not has_function_privilege('authenticated', 'public.record_pin_reset(uuid, uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.finish_user_creation(uuid, uuid, public.user_role, text)', 'execute'),
  'authenticated cannot call them');
select ok(not has_function_privilege('anon', 'public.finish_user_creation(uuid, uuid, public.user_role, text)', 'execute'),
  'anon cannot call finish_user_creation');

-- ---------------------------------------------------------------- pin_resets
select tests.as_service();
select lives_ok(format($$ select public.record_pin_reset(%L, %L) $$, tests.id('customer'), tests.id('admin')),
  'service_role records a reset');
select lives_ok(format($$ select public.record_pin_reset(%L, %L) $$, tests.id('driver'), tests.id('admin')),
  'second reset');
select tests.as_postgres();
select is((select count(*)::int from public.pin_resets where reset_by = tests.id('admin')), 2, 'resets recorded per admin');
select is((select count(*)::int from public.pin_resets where reset_by = tests.id('staff')), 0, 'other admins are counted apart');
update public.pin_resets set created_at = now() - interval '61 minutes' where user_id = tests.id('driver');
select is((select count(*)::int from public.pin_resets where reset_by = tests.id('admin') and created_at > now() - interval '1 hour'), 1, 'older than an hour is outside the window');
select tests.as_service();
select throws_ok($$ select count(*) from public.pin_resets $$, '42501', null,
  'service_role has no direct table access (functions only)');

select tests.as_user(tests.id('admin'));
select is((select count(*)::int from public.pin_resets where reset_by = tests.id('admin')), 2,
  'admin reads pin_resets');
select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.pin_resets), 0, 'staff sees no pin_resets (RLS)');
select tests.as_user(tests.id('customer'));
select is((select count(*)::int from public.pin_resets), 0, 'customer sees no pin_resets, even their own');
select throws_ok(format($$ insert into public.pin_resets (user_id, reset_by) values (%L, %L) $$,
    tests.id('customer'), tests.id('customer')), '42501', null, 'no direct insert into pin_resets');
select ok(not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'pin_resets' and column_name ~ 'pin$|password'),
  'pin_resets has no column for the PIN');

-- ---------------------------------------------------------------- user_creations / finish_user_creation
select tests.as_postgres();
select tests.remember('new', tests.new_user('customer'));
select tests.as_service();
select is(tests.try(format($$ select public.finish_user_creation(%L, %L, 'admin', 'x') $$, tests.id('new'), tests.id('admin'))),
  'INVALID_ROLE', 'admin role is refused');
select is(tests.try(format($$ select public.finish_user_creation(%L, %L, 'driver', 'x') $$, gen_random_uuid(), tests.id('admin'))),
  'USER_NOT_FOUND', 'unknown user is refused');
select lives_ok(format($$ select public.finish_user_creation(%L, %L, 'driver', '  سائق جديد ') $$, tests.id('new'), tests.id('admin')),
  'finish_user_creation sets role and name');
select tests.as_postgres();
select is((select row(role, full_name, is_active)::text from public.profiles where id = tests.id('new')),
  '(driver,"سائق جديد",t)', 'profile has the driver role and trimmed name');
select tests.as_postgres();
select is((select count(*)::int from public.user_creations where created_by = tests.id('admin')), 1, 'creation recorded for the admin');

select tests.as_user(tests.id('admin'));
select is((select role::text from public.user_creations where user_id = tests.id('new')), 'driver',
  'admin reads user_creations');
select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.user_creations), 0, 'staff sees no user_creations (RLS)');

-- ---------------------------------------------------------------- add_buildings
select tests.as_postgres();
with s as (insert into public.sectors (name) values ('test-sector T19') returning id),
     ss as (insert into public.subsections (sector_id, name) select id, 'T19-1' from s returning id)
select set_config('t.sub', (select id from ss)::text, true);
insert into public.buildings (subsection_id, number, sort_order)
  values (current_setting('t.sub')::int, '5', 5);

select tests.as_user(tests.id('staff'));
select is(tests.try(format($$ select public.add_buildings(%s, array['1']) $$, current_setting('t.sub'))),
  'NOT_ALLOWED', 'staff cannot add buildings');
select tests.as_user(tests.id('admin'));
select is(public.add_buildings(current_setting('t.sub')::int,
            (select array_agg(g::text) from generate_series(1, 100) g)),
  99, '1..100 in one call: 99 new, the existing 5 ignored');
select is(public.add_buildings(current_setting('t.sub')::int, array['1', '2', '2']), 0,
  'duplicates in the list and in the table are ignored');
select is((select count(*)::int from public.buildings where subsection_id = current_setting('t.sub')::int),
  100, 'unit now has buildings 1..100 (the DB format check allows nothing above 100)');
select is(tests.try(format($$ select public.add_buildings(%s, array['0']) $$, current_setting('t.sub'))),
  'INVALID_BUILDINGS', 'building 0 is rejected');
select is(tests.try(format($$ select public.add_buildings(%s, array['12a']) $$, current_setting('t.sub'))),
  'INVALID_BUILDINGS', 'non-numeric building is rejected');
select is(tests.try(format($$ select public.add_buildings(%s, (select array_agg(g::text) from generate_series(1, 501) g)) $$,
    current_setting('t.sub'))), 'INVALID_BUILDINGS', 'more than 500 numbers is rejected');
select is(tests.try($$ select public.add_buildings(-1, array['1']) $$), 'INVALID_BUILDINGS',
  'unknown unit is rejected');

select * from finish();
