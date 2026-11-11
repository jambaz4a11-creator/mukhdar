-- 05: دوال السائق (available_orders, accept_order, assign_driver) و RLS السائق
select plan(43);

-- طلبات موجودة مسبقاً (مثل seed:demo) لا تزاحم طلبات الاختبار ضمن حد available_orders.
-- تُعيَّن لسائق مؤقت داخل المعاملة، وكل شيء يُلغى بنهايتها.
with d as (select tests.new_user('driver') as id)
update public.orders o set driver_id = d.id from d
 where o.driver_id is null and o.status in ('pending', 'preparing');

select tests.remember('staff', tests.new_user('staff'));
select tests.remember('d1', tests.new_user('driver'));
select tests.remember('d2', tests.new_user('driver'));
select tests.remember('cust', tests.new_user('customer'));
select tests.remember('o_pending', tests.order_in('pending', tests.id('cust')));
select tests.remember('o_preparing', tests.order_in('preparing', tests.id('cust')));
select tests.remember('o_mine', tests.order_in('pending', tests.id('cust'), tests.id('d1')));
select tests.remember('o_cancelled', tests.order_in('cancelled', tests.id('cust')));
select tests.remember('o_delivered', tests.order_in('delivered', tests.id('cust')));

select ok(pg_get_function_result('public.available_orders(int)'::regprocedure) !~* '(phone|name)',
  'available_orders exposes no customer phone or name columns');

-- ---------------------------------------------------------------- available_orders
select tests.as_user(tests.id('d1'));
select is((select count(*)::int from public.available_orders(50)
            where id in (tests.id('o_pending'), tests.id('o_preparing'))), 2,
  'unassigned pending and preparing orders are available');
select is((select count(*)::int from public.available_orders(50)
            where id in (tests.id('o_mine'), tests.id('o_cancelled'), tests.id('o_delivered'))), 0,
  'assigned, cancelled and delivered orders are not available');
select is((select count(*)::int from public.available_orders(1)), 1, 'p_limit is respected');
select is_empty($$ select 1 from public.orders where id = tests.id('o_pending') $$,
  'driver cannot read an unassigned order (phone hidden) via RLS');
select is_empty($$ select 1 from public.order_items where order_id = tests.id('o_pending') $$,
  'driver cannot read items of an unassigned order');
select is((select customer_phone is not null from public.orders where id = tests.id('o_mine')), true,
  'driver reads the assigned order including customer phone');

select tests.as_user(tests.id('cust'));
select throws_ok($$ select * from public.available_orders() $$, 'NOT_ALLOWED', 'customer cannot list available orders');
select tests.as_user(tests.id('staff'));
select throws_ok($$ select * from public.available_orders() $$, 'NOT_ALLOWED', 'staff cannot list available orders');

-- ---------------------------------------------------------------- accept_order
select tests.as_user(tests.id('d1'));
select lives_ok(format($$ select public.accept_order(%L) $$, tests.id('o_pending')), 'first driver accepts');
select is((select driver_id from public.orders where id = tests.id('o_pending')), tests.id('d1'),
  'after accepting, driver reads the order');
select throws_ok(format($$ select public.accept_order(%L) $$, tests.id('o_cancelled')),
  'ORDER_NOT_AVAILABLE', 'cancelled order cannot be accepted');

select tests.as_user(tests.id('d2'));
select throws_ok(format($$ select public.accept_order(%L) $$, tests.id('o_pending')),
  'ORDER_NOT_AVAILABLE', 'second driver gets ORDER_NOT_AVAILABLE');
select is((select count(*)::int from public.available_orders(50) where id = tests.id('o_pending')), 0,
  'accepted order disappears from available_orders');

select tests.as_user(tests.id('cust'));
select throws_ok(format($$ select public.accept_order(%L) $$, tests.id('o_preparing')),
  'NOT_ALLOWED', 'customer cannot accept orders');

select tests.as_postgres();
select isnt_empty($$ select 1 from public.order_status_history
                     where order_id = tests.id('o_pending') and changed_by = tests.id('d1') and note = 'driver_accepted' $$,
  'accept is recorded in history');

-- ---------------------------------------------------------------- assign_driver
select tests.as_user(tests.id('staff'));
select lives_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_preparing'), tests.id('d2')),
  'staff assigns a driver');
select tests.as_postgres();
select is((select driver_id from public.orders where id = tests.id('o_preparing')), tests.id('d2'), 'driver set on the order');
select isnt_empty($$ select 1 from public.notification_outbox where audience = 'user' and user_id = tests.id('d2')
                       and data ->> 'order_id' = tests.id('o_preparing')::text and data ->> 'type' = 'assigned' $$,
  'assigned driver is notified');

select tests.as_user(tests.id('staff'));
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_preparing'), tests.id('cust')),
  'DRIVER_NOT_FOUND', 'cannot assign a non-driver');
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_delivered'), tests.id('d2')),
  'ORDER_NOT_AVAILABLE', 'cannot assign a delivered order');
select lives_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_mine'), tests.id('d2')),
  'staff reassigns an order to another driver');
select tests.as_postgres();
select isnt_empty($$ select 1 from public.notification_outbox where audience = 'user' and user_id = tests.id('d1')
                       and data ->> 'order_id' = tests.id('o_mine')::text and data ->> 'type' = 'unassigned' $$,
  'previous driver is notified about the reassignment');
select is_empty($$ select 1 from public.notification_outbox where true
                     and data ->> 'order_id' = tests.id('o_preparing')::text and data ->> 'type' = 'unassigned' $$,
  'first assignment sends no unassigned notice');

select tests.as_user(tests.id('d1'));
select is_empty($$ select 1 from public.orders where id = tests.id('o_mine') $$,
  'previous driver loses access after reassignment');
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_mine'), tests.id('d1')),
  'NOT_ALLOWED', 'driver cannot assign orders');
select tests.as_user(tests.id('cust'));
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_mine'), tests.id('d1')),
  'NOT_ALLOWED', 'customer cannot assign orders');

-- ---------------------------------------------------------------- سائق معطّل
select tests.as_postgres();
select tests.remember('d_off', tests.new_user('driver'));
select tests.remember('o_off', tests.order_in('preparing', tests.id('cust'), tests.id('d_off')));
select tests.remember('o_free', tests.order_in('pending', tests.id('cust')));
select tests.as_user(tests.id('d_off'));
select isnt_empty($$ select 1 from public.orders where id = tests.id('o_off') $$,
  'active driver reads the assigned order');
select tests.as_postgres();
update public.profiles set is_active = false where id = tests.id('d_off');
select tests.as_user(tests.id('d_off'));
select is_empty($$ select 1 from public.orders $$,
  'deactivated driver reads no orders, not even assigned ones');
select is_empty($$ select 1 from public.order_items where order_id = tests.id('o_off') $$,
  'deactivated driver cannot read items of the assigned order');
select is_empty($$ select 1 from public.order_status_history where order_id = tests.id('o_off') $$,
  'deactivated driver cannot read history of the assigned order');
select throws_ok($$ select * from public.available_orders() $$, 'NOT_ALLOWED',
  'deactivated driver cannot list available orders');
select throws_ok(format($$ select public.accept_order(%L) $$, tests.id('o_free')), 'NOT_ALLOWED',
  'deactivated driver cannot accept orders');
select throws_ok(format($$ select public.set_order_status(%L, 'out_for_delivery') $$, tests.id('o_off')),
  'NOT_AUTHENTICATED', 'deactivated driver cannot change the status of an assigned order');
select tests.as_user(tests.id('staff'));
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_free'), tests.id('d_off')),
  'DRIVER_NOT_FOUND', 'cannot assign a deactivated driver');
select tests.as_postgres();
select is((select driver_id from public.orders where id = tests.id('o_free')), null::uuid,
  'order stays unassigned');
update public.profiles set is_active = true where id = tests.id('d_off');
select tests.as_user(tests.id('d_off'));
select isnt_empty($$ select 1 from public.orders where id = tests.id('o_off') $$,
  'reactivated driver reads the assigned order again');
select tests.as_postgres();
update public.profiles set role = 'customer' where id = tests.id('d_off');
select tests.as_user(tests.id('d_off'));
select is_empty($$ select 1 from public.orders where id = tests.id('o_off') $$,
  'a former driver (now customer) cannot read orders assigned to them as a driver');

-- ---------------------------------------------------------------- list_drivers (موظف/أدمن)
select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.list_drivers() where id in (tests.id('d1'), tests.id('d2'))), 2,
  'staff lists drivers');
select is((select count(*)::int from public.list_drivers() where id = tests.id('cust')), 0,
  'list_drivers returns drivers only');
select is(pg_get_function_result('public.list_drivers()'::regprocedure),
  'TABLE(id uuid, full_name text, phone text, is_active boolean)', 'list_drivers returns only id, name, phone, active');
select tests.as_user(tests.id('d1'));
select throws_ok($$ select * from public.list_drivers() $$, 'NOT_ALLOWED', 'driver cannot list drivers');
select tests.as_user(tests.id('cust'));
select throws_ok($$ select * from public.list_drivers() $$, 'NOT_ALLOWED', 'customer cannot list drivers');

select * from finish();
