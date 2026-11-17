-- 12: حذف الحساب (T08): begin/abort_account_deletion، وما يبقى بعد حذف المستخدم من auth.users
select plan(43);

select tests.remember('cust', tests.new_user('customer'));
select tests.remember('busy', tests.new_user('customer'));
select tests.remember('drv', tests.new_user('driver'));
select tests.remember('drv_busy', tests.new_user('driver'));
select tests.remember('adm', tests.new_user('admin'));
select tests.remember('stf', tests.new_user('staff'));
select tests.remember('off', tests.new_user('customer'));
update public.profiles set is_active = false where id = tests.id('off');

select tests.remember('o_del', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('o_can', tests.order_in('cancelled', tests.id('cust')));
select tests.remember('o_pend', tests.order_in('pending', tests.id('busy')));
select tests.remember('o_out', tests.order_in('out_for_delivery', null, tests.id('drv_busy')));
select tests.as_user(tests.id('cust'));
select public.rate_order(tests.id('o_del'), 5, 'ممتاز');
select public.register_push_token('ExponentPushToken[t12-cust]', 'ios');
select tests.as_postgres();

-- ---------------------------------------------------------------- الصلاحيات
select ok(has_function_privilege('service_role', 'public.begin_account_deletion(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.abort_account_deletion(uuid, boolean)', 'execute'),
  'service_role can run the deletion guard');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated']) r(role),
          unnest(array['public.begin_account_deletion(uuid)', 'public.abort_account_deletion(uuid, boolean)']) f(fn)
    where has_function_privilege(r.role, f.fn, 'execute')),
  0, 'anon/authenticated cannot run the deletion guard');
select tests.as_user(tests.id('cust'));
select throws_ok(format($$ select public.begin_account_deletion(%L) $$, tests.id('busy')), '42501', null,
  'an app user cannot call begin_account_deletion directly');

-- ---------------------------------------------------------------- الرفض
select tests.as_service();
select throws_ok(format($$ select public.begin_account_deletion(%L) $$, tests.id('adm')), 'ADMIN_ACCOUNT',
  'admin account cannot be deleted from the app');
select throws_ok(format($$ select public.begin_account_deletion(%L) $$, tests.id('busy')), 'ACTIVE_ORDER',
  'customer with a pending order → ACTIVE_ORDER');
select throws_ok(format($$ select public.begin_account_deletion(%L) $$, tests.id('drv_busy')), 'ACTIVE_ORDER',
  'driver holding an out_for_delivery order → ACTIVE_ORDER');
select throws_ok($$ select public.begin_account_deletion(gen_random_uuid()) $$, 'USER_NOT_FOUND', 'unknown user');
select throws_ok($$ select public.begin_account_deletion(null) $$, 'USER_NOT_FOUND', 'null user');
select tests.as_postgres();
select is((select count(*)::int from public.profiles
            where id in (tests.id('adm'), tests.id('busy'), tests.id('drv_busy')) and is_active), 3,
  'refused accounts stay active');

-- ---------------------------------------------------------------- القبول، التعطيل، الإرجاع
select tests.as_service();
select is(public.begin_account_deletion(tests.id('cust')), true,
  'customer with only finished orders is accepted (returns previous is_active)');
select tests.as_postgres();
select is((select is_active from public.profiles where id = tests.id('cust')), false,
  'account is deactivated while deletion runs');
select throws_ok(format($$ select tests.place(%L, jsonb_build_array(tests.item(tests.new_product(1000), 1))) $$,
  tests.id('cust')), 'NOT_CUSTOMER', 'a deactivated account cannot place an order meanwhile');
select tests.as_service();
select lives_ok(format($$ select public.abort_account_deletion(%L, true) $$, tests.id('cust')),
  'abort after a failed deleteUser');
select tests.as_postgres();
select is((select is_active from public.profiles where id = tests.id('cust')), true, 'abort restores is_active');

-- انقطاع بين begin و deleteUser ثم إعادة المحاولة (N2): الحالة الأصلية محفوظة
select tests.as_postgres();
select tests.remember('crash', tests.new_user('customer'));
select tests.as_service();
select is(public.begin_account_deletion(tests.id('crash')), true, 'first attempt: was active');
select is(public.begin_account_deletion(tests.id('crash')), true,
  'retry after a crash still returns the original state (not the deactivated one)');
select lives_ok(format($$ select public.abort_account_deletion(%L, false) $$, tests.id('crash')),
  'abort with a stale p_was_active');
select tests.as_postgres();
select is((select is_active from public.profiles where id = tests.id('crash')), true,
  'abort restores the stored original state');
select is_empty(format($$ select 1 from private.account_deletions where user_id = %L $$, tests.id('crash')),
  'abort clears the stored state');

select tests.as_service();
select is(public.begin_account_deletion(tests.id('off')), false, 'already-deactivated user can still delete');
select lives_ok(format($$ select public.abort_account_deletion(%L, false) $$, tests.id('off')), 'abort (was inactive)');
select tests.as_postgres();
select is((select is_active from public.profiles where id = tests.id('off')), false,
  'abort keeps a previously-deactivated account inactive');
select tests.as_service();
select is(public.begin_account_deletion(tests.id('stf')), true, 'staff account can be deleted');
select is(public.begin_account_deletion(tests.id('drv')), true, 'driver whose orders are finished can be deleted');

-- ---------------------------------------------------------------- بعد deleteUser (= حذف auth.users)
select tests.as_postgres();
select set_config('t.stats_before', (select coalesce(sum(delivered_count), 0) || '/' ||
  coalesce(sum(cancelled_count), 0) || '/' || coalesce(sum(revenue_iqd), 0) from public.daily_stats), true);
select is(public.begin_account_deletion(tests.id('cust')), true, 'begin for the customer');
delete from auth.users where id in (tests.id('cust'), tests.id('drv'));

select is_empty(format($$ select 1 from public.profiles where id = %L $$, tests.id('cust')), 'profile is deleted');
select is_empty(format($$ select 1 from private.account_deletions where user_id = %L $$, tests.id('cust')),
  'stored deletion state goes with the profile');
select ok(pg_get_functiondef('public.accept_order(uuid)'::regprocedure) ~ 'from public\.profiles\s+where id = v_uid and role = ''driver'' and is_active and not must_change_pin for share',
  'accept_order locks the driver profile (serialised with begin_account_deletion, N1)');
select is_empty(format($$ select 1 from public.addresses where customer_id = %L $$, tests.id('cust')),
  'addresses are deleted');
select is_empty($$ select 1 from public.push_tokens where token = 'ExponentPushToken[t12-cust]' $$,
  'push tokens are deleted');
select is((select count(*)::int from public.orders where id in (tests.id('o_del'), tests.id('o_can'))), 2,
  'orders are kept');
select is((select count(*)::int from public.orders
            where id in (tests.id('o_del'), tests.id('o_can')) and customer_id is null), 2,
  'kept orders have customer_id = null');
select is((select customer_name from public.orders where id = tests.id('o_del')), null,
  'order loses the customer name (T23 M5)');
select is((select customer_phone from public.orders where id = tests.id('o_del')), null,
  'order loses the customer phone (T23 M5)');
select is((select address_snapshot from public.orders where id = tests.id('o_del')) ? 'sector'
      and (select address_snapshot from public.orders where id = tests.id('o_del')) ? 'subsection', true,
  'order keeps sector and unit (T23 M5)');
select is((select address_snapshot - 'sector' - 'subsection' from public.orders where id = tests.id('o_del')),
  '{}'::jsonb, 'order keeps nothing else of the address: no building, apartment, note, address_id (T23 M5)');
select is((select subtotal_iqd > 0 and total_iqd > 0 from public.orders where id = tests.id('o_del')), true,
  'order keeps its amounts for accounting (T23 M5)');
select is((select driver_id from public.orders where id = tests.id('o_del')), null,
  'deleted driver → driver_id = null on finished orders');
select is((select count(*)::int from public.order_items where order_id = tests.id('o_del')) > 0, true,
  'order items are kept');
select row_eq(format($$ select stars::int, customer_id from public.ratings where order_id = %L $$, tests.id('o_del')),
  row(5, null::uuid), 'rating is kept, anonymised');
select is((select count(*)::int from public.order_status_history where order_id = tests.id('o_del')) >= 3, true,
  'status history is kept');
select is((select coalesce(sum(delivered_count), 0) || '/' || coalesce(sum(cancelled_count), 0) || '/' ||
                  coalesce(sum(revenue_iqd), 0) from public.daily_stats),
  current_setting('t.stats_before'), 'daily reports are unchanged by the deletion');
select is((select is_active from public.profiles where id = tests.id('busy')), true,
  'other accounts are untouched');

select * from finish();
