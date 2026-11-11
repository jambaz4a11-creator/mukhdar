-- 05: دوال السائق (available_orders, accept_order, assign_driver) و RLS السائق
select plan(25);

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

select tests.as_user(tests.id('d1'));
select is_empty($$ select 1 from public.orders where id = tests.id('o_mine') $$,
  'previous driver loses access after reassignment');
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_mine'), tests.id('d1')),
  'NOT_ALLOWED', 'driver cannot assign orders');
select tests.as_user(tests.id('cust'));
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_mine'), tests.id('d1')),
  'NOT_ALLOWED', 'customer cannot assign orders');

select * from finish();
