-- 08: الأدوار والملف الشخصي ومنع الكتابة المباشرة على الطلبات
select plan(29);

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('admin2', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('cust', tests.new_user('customer'));
select tests.remember('cust2', tests.new_user('customer'));
select tests.remember('o2', tests.order_in('pending', tests.id('cust2')));

-- ---------------------------------------------------------------- customer
select tests.as_user(tests.id('cust'));
select throws_ok($$ update public.profiles set role = 'admin' where id = (select auth.uid()) $$,
  '42501', null, 'customer cannot change own role');
select throws_ok($$ update public.profiles set is_active = false where id = (select auth.uid()) $$,
  '42501', null, 'customer cannot change is_active');
select throws_ok($$ update public.profiles set phone = '1' where id = (select auth.uid()) $$,
  '42501', null, 'customer cannot change phone');
select results_eq($$ with u as (update public.profiles set full_name = 'أبو علي' where id = (select auth.uid()) returning full_name)
                     select full_name from u $$, array['أبو علي'], 'customer updates own name');
select results_eq(format($$ with u as (update public.profiles set full_name = 'x' where id = %L returning 1)
                            select count(*)::int from u $$, tests.id('cust2')), array[0], 'customer cannot rename someone else');
select results_eq($$ select id from public.profiles $$, array[tests.id('cust')], 'customer reads only own profile');
select throws_ok(format($$ select public.set_user_role(%L, 'admin') $$, tests.id('cust')),
  'NOT_ALLOWED', 'customer cannot call set_user_role');
select throws_ok($$ insert into public.orders (address_snapshot, subtotal_iqd, delivery_fee_iqd, total_iqd, idempotency_key)
                    values ('{}', 0, 0, 0, gen_random_uuid()) $$, '42501', null, 'direct insert into orders is denied');
select throws_ok(format($$ update public.orders set total_iqd = 0 where id = %L $$, tests.id('o2')),
  '42501', null, 'direct update of orders is denied');
select throws_ok(format($$ insert into public.order_items (order_id, name_snapshot, unit_snapshot, price_snapshot_iqd, qty, line_total_iqd)
                           values (%L, 'x', 'x', 0, 1, 0) $$, tests.id('o2')),
  '42501', null, 'direct insert into order_items is denied');
select is_empty(format($$ select 1 from public.orders where id = %L $$, tests.id('o2')), 'customer cannot read others'' orders');
select is_empty(format($$ select 1 from public.order_items where order_id = %L $$, tests.id('o2')),
  'customer cannot read others'' order items');
select is_empty(format($$ select 1 from public.order_status_history where order_id = %L $$, tests.id('o2')),
  'customer cannot read others'' order history');
select throws_ok($$ select * from public.notification_outbox $$, '42501', null, 'customer cannot read notification_outbox');
select throws_ok($$ select public._notify('admins', null, 'x', 'y') $$, '42501', null, 'customer cannot call internal _notify');
select is(private.is_admin(), false, 'private.is_admin() is false for a customer');
select is(public.is_admin(), false, 'public.is_admin() is false for a customer');

-- ---------------------------------------------------------------- staff
select tests.as_user(tests.id('staff'));
select throws_ok(format($$ select public.set_user_role(%L, 'driver') $$, tests.id('cust')),
  'NOT_ALLOWED', 'staff cannot call set_user_role');
select isnt_empty(format($$ select 1 from public.orders where id = %L $$, tests.id('o2')), 'staff reads all orders');

-- ---------------------------------------------------------------- admin
-- R1 H1: زبون ← سائق يتطلب رمزاً مؤقتاً (أعاد الأدمن ضبط رمزه)
select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('cust');
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'driver') $$, tests.id('cust')), 'admin makes a customer a driver');
select is((select role from public.profiles where id = tests.id('cust')), 'driver'::public.user_role, 'role changed');
select throws_ok(format($$ select public.set_user_role(%L, 'customer') $$, tests.id('admin')),
  'CANNOT_DEMOTE_SELF', 'admin cannot demote self');
select throws_ok(format($$ select public.set_user_role(%L, 'admin', false) $$, tests.id('admin')),
  'CANNOT_DEMOTE_SELF', 'admin cannot deactivate self');
select throws_ok($$ select public.set_user_role(gen_random_uuid(), 'driver') $$, 'USER_NOT_FOUND', 'unknown user');
select is((select count(*)::int from public.profiles where id in (tests.id('cust'), tests.id('cust2'), tests.id('staff'))), 3,
  'admin reads all profiles');
select lives_ok(format($$ select public.set_user_role(%L, 'admin', false) $$, tests.id('admin2')), 'admin deactivates another admin');

select tests.as_user(tests.id('admin2'));
select is(private.is_admin(), false, 'deactivated admin loses admin rights');
select throws_ok($$ select public.adjust_stock(gen_random_uuid(), 1, 'purchase') $$, 'NOT_ALLOWED',
  'deactivated admin cannot use admin RPCs');

select tests.as_anon();
select throws_ok(format($$ select public.set_user_role(%L, 'admin') $$, tests.id('cust')), '42501', null,
  'anon cannot execute set_user_role');

select * from finish();
