-- 41: R4 L10 (migration 20261214000001): update_app_settings, set_order_status and assign_driver run with
--   search_path = '' and still do everything they did. Every call is by the real role (staff/admin aal2, driver,
--   customer); postgres only prepares data and reads rows back. Checks are limited to this file's own users and orders.
select plan(29);

-- ================================================================ setup (postgres)
select tests.remember('admin', tests.new_user('admin', 'مدير'));
select tests.remember('staff', tests.new_user('staff', 'موظف'));
select tests.remember('cust',  tests.new_user('customer'));
select tests.remember('cust2', tests.new_user('customer'));
select tests.remember('drv',   tests.new_user('driver', 'سائق أول'));
select tests.remember('drv2',  tests.new_user('driver', 'سائق ثاني'));
select tests.remember('o1', tests.place(tests.id('cust'),  jsonb_build_array(tests.item(tests.new_product(1000, 10), 1))));
select tests.remember('o2', tests.place(tests.id('cust2'), jsonb_build_array(tests.item(tests.new_product(1000, 10), 2))));
select tests.remember('o3', tests.place(tests.id('cust'),  jsonb_build_array(tests.item(tests.new_product(1000, 10), 1))));

-- ================================================================ the setting itself
select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('public.update_app_settings(jsonb)'::regprocedure,
                    'public.set_order_status(uuid, public.order_status, text, boolean)'::regprocedure,
                    'public.assign_driver(uuid, uuid)'::regprocedure)
      and p.prosecdef and p.proconfig = array['search_path=""']),
  3, 'the three functions are SECURITY DEFINER with search_path pinned to the empty string');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('update_app_settings', 'set_order_status', 'assign_driver')),
  3, 'no stray overload of the three functions (the setting covers every one of them)');
select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('public.update_app_settings(jsonb)'::regprocedure,
                    'public.set_order_status(uuid, public.order_status, text, boolean)'::regprocedure,
                    'public.assign_driver(uuid, uuid)'::regprocedure)
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')),
  3, 'grants unchanged: authenticated can execute, anon cannot');

-- ================================================================ update_app_settings
select tests.as_user(tests.id('admin'));
select is(tests.try($$select public.update_app_settings('{"delivery_fee_iqd": 1500, "store_open": true}')$$), 'OK',
  'update_app_settings: admin changes the delivery fee');
select is(tests.try($$select public.update_app_settings('{"delivery_fee_iqd": 1501}')$$), 'INVALID_SETTINGS',
  'update_app_settings: a value that is not a multiple of 250 is refused');
select is(tests.try($$select public.update_app_settings('{"no_such_key": 1}')$$), 'INVALID_SETTINGS',
  'update_app_settings: an unknown key is refused');
select tests.as_user(tests.id('staff'));
select is(tests.try($$select public.update_app_settings('{"delivery_fee_iqd": 2000}')$$), 'NOT_ALLOWED',
  'update_app_settings: staff is refused');
select tests.as_postgres();
select is((select delivery_fee_iqd from public.app_settings where id = 1)::int, 1500,
  'update_app_settings: the fee is 1500 (the refused calls changed nothing)');
select is((select count(*)::int from public.admin_audit
            where action = 'settings' and actor = tests.id('admin') and after ->> 'delivery_fee_iqd' = '1500'),
  1, 'update_app_settings: one audit line with the changed field');

-- ================================================================ assign_driver
select tests.as_user(tests.id('cust'));
select is(tests.try(format('select public.assign_driver(%L, %L)', tests.id('o1'), tests.id('drv'))), 'NOT_ALLOWED',
  'assign_driver: a customer is refused');
select tests.as_user(tests.id('staff'));
select is(tests.try(format('select public.set_order_status(%L, %L)', tests.id('o1'), 'preparing')), 'OK',
  'set_order_status: staff moves pending to preparing');
select is(tests.try(format('select public.assign_driver(%L, %L)', tests.id('o1'), tests.id('cust2'))), 'DRIVER_NOT_FOUND',
  'assign_driver: a non-driver is refused (DRIVER_NOT_FOUND)');
select is(tests.try(format('select public.assign_driver(%L, %L)', tests.id('o1'), tests.id('drv'))), 'OK',
  'assign_driver: staff assigns a driver');
select tests.as_postgres();
select is((select driver_id from public.orders where id = tests.id('o1')), tests.id('drv'),
  'assign_driver: the driver is on the order');
select ok((select count(*) from public.notification_outbox
            where data ->> 'order_id' = tests.id('o1')::text and data ->> 'type' = 'assigned') >= 1,
  'assign_driver: the driver notification was queued');
select tests.as_user(tests.id('admin'));
select is(tests.try(format('select public.assign_driver(%L, %L)', tests.id('o1'), tests.id('drv2'))), 'OK',
  'assign_driver: admin reassigns to another driver');
select tests.as_postgres();
select is((select count(*)::int from public.admin_audit where action = 'order_driver' and target_id = tests.id('o1')),
  1, 'assign_driver: the reassignment is audited');

-- ================================================================ set_order_status: each actor as itself
select tests.as_user(tests.id('admin'));
select is(tests.try(format('select public.set_order_status(%L, %L)', tests.id('o1'), 'ready')), 'OK',
  'set_order_status: admin preparing to ready');
select tests.as_user(tests.id('drv2'));
select is(tests.try(format('select public.set_order_status(%L, %L)', tests.id('o1'), 'out_for_delivery')), 'OK',
  'set_order_status: the assigned driver goes out for delivery');
select is(tests.try(format('select public.set_order_status(%L, %L)', tests.id('o1'), 'delivered')), 'OK',
  'set_order_status: the assigned driver delivers');
select tests.as_user(tests.id('drv'));
select is(tests.try(format('select public.set_order_status(%L, %L)', tests.id('o3'), 'preparing')), 'NOT_ALLOWED',
  'set_order_status: a driver who is not on the order is refused');
select tests.as_user(tests.id('admin'));
select is(tests.try(format('select public.set_order_status(%L, %L)', tests.id('o3'), 'delivered')), 'INVALID_TRANSITION',
  'set_order_status: pending to delivered is an invalid transition');
select tests.as_postgres();
select is((select status::text from public.orders where id = tests.id('o1')), 'delivered',
  'set_order_status: the order is delivered');
select is((select count(*)::int from public.order_status_history
            where order_id = tests.id('o1') and from_status is distinct from to_status
              and to_status in ('preparing', 'ready', 'out_for_delivery', 'delivered')),
  4, 'set_order_status: history has preparing, ready, out_for_delivery and delivered');
select ok((select delivered_count from public.daily_stats where day = public.baghdad_today()) >= 1,
  'set_order_status: delivery updated daily_stats (_bump_daily_stats works with the empty search_path)');

-- cancel by the customer returns the stock (cancel_return movement), saves the cleaned reason and notifies
select tests.as_user(tests.id('cust2'));
select is(tests.try(format('select public.set_order_status(%L, %L, %L)', tests.id('o2'), 'cancelled', 'غيّرت رأيي')), 'OK',
  'set_order_status: the customer cancels their pending order');
select tests.as_postgres();
select is((select count(*)::int from public.inventory_movements where order_id = tests.id('o2') and type = 'cancel_return'),
  1, 'set_order_status: cancelling returned the stock (one cancel_return movement)');
select is((select cancel_reason from public.orders where id = tests.id('o2')), 'غيّرت رأيي',
  'set_order_status: the cancel reason is saved (private.clean_user_text works with the empty search_path)');
select ok((select count(*) from public.notification_outbox where data ->> 'order_id' = tests.id('o2')::text) >= 1,
  'set_order_status: the cancellation notification was queued');

select * from finish();
