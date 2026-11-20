-- 20: مراجعة T16-T19، جلسة A (migration 20261123000001): الرمز المؤقت الإجباري، تعطيل/تخفيض الدور
-- (الجلسات، الوصول، سائق بطلبات)، سجل التدقيق، نقل طلب بالطريق، الإلغاء بلا إرجاع، إشعار "جاهز" مرة واحدة.
select plan(71);

select tests.remember('admin',  tests.new_user('admin'));
select tests.remember('admin2', tests.new_user('admin'));
select tests.remember('staff',  tests.new_user('staff'));
select tests.remember('staff2', tests.new_user('staff'));
select tests.remember('d1',     tests.new_user('driver'));
select tests.remember('d2',     tests.new_user('driver'));
select tests.remember('cust',   tests.new_user('customer'));

-- ================================================================ 1) must_change_pin
select col_not_null('public', 'profiles', 'must_change_pin', 'profiles.must_change_pin exists, not null');
select is((select must_change_pin from public.profiles where id = tests.id('cust')), false, 'default false');

select tests.as_user(tests.id('cust'));
select throws_ok(format($$ update public.profiles set must_change_pin = false where id = %L $$, tests.id('cust')),
  '42501', null, 'a user cannot change their own must_change_pin');
select tests.as_postgres();

-- admin-reset-pin: الرمز ← الجلسات ← record_pin_reset (يضبط العلامة)
select tests.as_service();
select lives_ok(format($$ select public.record_pin_reset(%L, %L) $$, tests.id('cust'), tests.id('admin')),
  'record_pin_reset (service_role)');
select tests.as_postgres();
select is((select must_change_pin from public.profiles where id = tests.id('cust')), true,
  'record_pin_reset sets must_change_pin');

select tests.remember('cust_addr', tests.new_address(tests.id('cust')));
select tests.remember('p1', tests.new_product(1000, 10));
select tests.as_user(tests.id('cust'));
select is(private.current_user_role(), null, 'flagged user: current_user_role() is null');
select throws_ok(format($$ select public.place_order(%L, %L::jsonb, gen_random_uuid()) $$,
  tests.id('cust_addr'), jsonb_build_array(tests.item(tests.id('p1'), 1))),
  '42501', 'PIN_CHANGE_REQUIRED', 'flagged customer cannot order');
select is((select count(*)::int from public.profiles where id = tests.id('cust')), 1,
  'flagged user still reads their own profile (to see the flag)');
select tests.as_postgres();

-- finish_user_creation يضبطها أيضاً (admin-create-user)
select tests.remember('newd', tests.new_user('customer'));
select tests.as_service();
select public.finish_user_creation(tests.id('newd'), tests.id('admin'), 'driver', 'سائق جديد');
select tests.as_postgres();
select is((select must_change_pin from public.profiles where id = tests.id('newd')), true,
  'finish_user_creation sets must_change_pin');
select tests.as_user(tests.id('newd'));
select throws_ok($$ select * from public.available_orders() $$, '42501', 'NOT_ALLOWED',
  'flagged driver cannot list available orders');
select tests.as_postgres();

-- staff مؤقت: لا RPC ولا RLS بدور الموظف
update public.profiles set must_change_pin = true where id = tests.id('staff2');
select tests.as_user(tests.id('staff2'));
select throws_ok($$ select * from public.list_drivers() $$, '42501', 'NOT_ALLOWED', 'flagged staff cannot call list_drivers');
select is((select count(*)::int from public.orders), 0, 'flagged staff reads no orders');
select tests.as_postgres();

-- تغيير كلمة السر فعلاً (GoTrue updateUser) يمسحها
update auth.users set encrypted_password = 'changed-hash-' || gen_random_uuid() where id = tests.id('cust');
select is((select must_change_pin from public.profiles where id = tests.id('cust')), false,
  'a real password change clears must_change_pin (trigger)');
update auth.users set phone = phone where id = tests.id('staff2');
select is((select must_change_pin from public.profiles where id = tests.id('staff2')), true,
  'other auth.users updates do not clear it');
select tests.as_user(tests.id('cust'));
select is(private.current_user_role(), 'customer'::public.user_role, 'after the change the role is back');
select tests.as_postgres();

-- ================================================================ 2) معطّل/مخفَّض: لا وصول
update public.profiles set is_active = false where id = tests.id('admin2');
select tests.as_user(tests.id('admin2'));
select throws_ok(format($$ select public.set_user_role(%L, 'driver') $$, tests.id('cust')), '42501', 'NOT_ALLOWED',
  'deactivated admin: set_user_role refused');
select throws_ok($$ select public.update_app_settings('{"store_open": true}') $$, '42501', 'NOT_ALLOWED',
  'deactivated admin: update_app_settings refused');
select throws_ok(format($$ select public.adjust_stock(%L, -1, 'waste') $$, tests.id('p1')), '42501', 'NOT_ALLOWED',
  'deactivated admin: adjust_stock refused');
select is((select count(*)::int from public.admin_audit), 0, 'deactivated admin reads no audit rows');
select tests.as_postgres();
update public.profiles set is_active = true where id = tests.id('admin2');

select tests.remember('o_staff', tests.order_in('preparing'));
update public.profiles set is_active = false where id = tests.id('staff');
select tests.as_user(tests.id('staff'));
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_staff'), tests.id('d1')), '42501', 'NOT_ALLOWED',
  'deactivated staff: assign_driver refused');
select throws_ok(format($$ select public.set_order_status(%L, 'ready') $$, tests.id('o_staff')), '28000', 'NOT_AUTHENTICATED',
  'deactivated staff: set_order_status refused');
select is((select count(*)::int from public.orders), 0, 'deactivated staff reads no orders');
select tests.as_postgres();
update public.profiles set is_active = true where id = tests.id('staff');

-- ================================================================ 3) set_user_role: الجلسات والتدقيق
create function tests.add_session(p_user uuid) returns void language sql as $$
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), p_user, now(), now());
  insert into auth.refresh_tokens (token, user_id, revoked, session_id, created_at, updated_at)
  select 'rt-' || gen_random_uuid(), p_user::text, false, (select id from auth.sessions where user_id = p_user limit 1), now(), now();
$$;
create function tests.sessions(p_user uuid) returns int language sql as $$
  select (select count(*) from auth.sessions where user_id = p_user)::int
       + (select count(*) from auth.refresh_tokens where user_id = p_user::text)::int
$$;
select tests.add_session(tests.id('staff'));
select tests.add_session(tests.id('cust'));
select tests.add_session(tests.id('d2'));

select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'staff', false) $$, tests.id('staff')), 'admin deactivates a staff member');
select tests.as_postgres();
select is(tests.sessions(tests.id('staff')), 0, 'deactivation revokes every session and refresh token');
select results_eq(
  format($$ select actor, action, before, after from public.admin_audit where target_id = %L $$, tests.id('staff')),
  format($$ values (%L::uuid, 'user_role'::text, '{"role": "staff", "is_active": true}'::jsonb,
                    '{"role": "staff", "is_active": false}'::jsonb) $$, tests.id('admin')),
  'audit row: who, old → new');

select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('cust');  -- R1 H1: ترقية زبون لسائق بعد إعادة ضبط الرمز
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'staff', true) $$, tests.id('staff')), 'reactivate');
select lives_ok(format($$ select public.set_user_role(%L, 'staff', true) $$, tests.id('staff')), 'same values again: no-op');
select lives_ok(format($$ select public.set_user_role(%L, 'driver') $$, tests.id('cust')), 'promote customer to driver');
select tests.as_postgres();
select is(tests.sessions(tests.id('staff')), 0, 're-activation does not bring sessions back (fresh PIN login)');
select is((select count(*)::int from public.admin_audit where target_id = tests.id('staff')), 2,
  'no-op writes no audit row');
select ok(tests.sessions(tests.id('cust')) > 0, 'promotion keeps sessions');

select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'customer') $$, tests.id('d2')), 'demote driver (no orders) to customer');
select tests.as_postgres();
select is(tests.sessions(tests.id('d2')), 0, 'demotion revokes sessions');
update public.profiles set role = 'driver' where id = tests.id('d2');

-- أدمن يزيل أدمناً آخر: مسموح ويُسجَّل؛ لا أحد يزيل نفسه، فيبقى أدمن نشط دائماً
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'staff') $$, tests.id('admin2')), 'admin demotes another admin');
select throws_ok(format($$ select public.set_user_role(%L, 'staff') $$, tests.id('admin')), 'P0001', 'CANNOT_DEMOTE_SELF',
  'cannot demote yourself');
select throws_ok(format($$ select public.set_user_role(%L, 'admin', false) $$, tests.id('admin')), 'P0001', 'CANNOT_DEMOTE_SELF',
  'cannot deactivate yourself');
select tests.as_postgres();
select is((select after ->> 'role' from public.admin_audit where target_id = tests.id('admin2')), 'staff',
  'admin demotion is audited');
select ok((select count(*) from public.profiles where role = 'admin' and is_active) >= 1, 'an active admin remains');

-- ================================================================ 4) سائق عنده طلبات
select tests.remember('o_ready', tests.order_in('ready', null, tests.id('d1')));
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.set_user_role(%L, 'driver', false) $$, tests.id('d1')), 'P0001', 'DRIVER_HAS_ORDERS',
  'cannot deactivate a driver holding a ready order');
select throws_ok(format($$ select public.set_user_role(%L, 'customer') $$, tests.id('d1')), 'P0001', 'DRIVER_HAS_ORDERS',
  'cannot demote a driver holding a ready order');
select tests.as_postgres();
create function tests.err_detail(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return v;
end $$;
grant execute on function tests.err_detail(text) to authenticated;
select tests.as_user(tests.id('admin'));
select is(tests.err_detail(format($$ select public.set_user_role(%L, 'customer') $$, tests.id('d1'))),
  '#' || (select order_number from public.orders where id = tests.id('o_ready')),
  'the error detail lists the order numbers');
select tests.as_postgres();
select is((select role::text || is_active::text from public.profiles where id = tests.id('d1')), 'drivertrue',
  'the driver is unchanged');

-- ================================================================ 5) نقل طلب بالطريق لسائق آخر
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o_ready'), 'out_for_delivery');
select tests.as_user(tests.id('staff'));
select lives_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_ready'), tests.id('d2')),
  'staff reassigns an out_for_delivery order to another active driver');
select tests.as_postgres();
select is((select driver_id from public.orders where id = tests.id('o_ready')), tests.id('d2'), 'the new driver holds it');
select is((select status::text from public.orders where id = tests.id('o_ready')), 'out_for_delivery', 'status unchanged');
select is((select note from public.order_status_history where order_id = tests.id('o_ready') order by id desc limit 1),
  'driver_reassigned', 'history note driver_reassigned');
select results_eq(
  format($$ select actor, before ->> 'driver_id', after ->> 'driver_id' from public.admin_audit
             where action = 'order_driver' and target_id = %L $$, tests.id('o_ready')),
  format($$ values (%L::uuid, %L::text, %L::text) $$, tests.id('staff'), tests.id('d1'), tests.id('d2')),
  'reassignment audited (who, old driver → new driver)');
select isnt_empty(format($$ select 1 from public.notification_outbox where user_id = %L and data ->> 'type' = 'unassigned'
  and data ->> 'order_id' = %L $$, tests.id('d1'), tests.id('o_ready')), 'the previous driver is told');
select tests.as_user(tests.id('d1'));
select throws_ok(format($$ select public.set_order_status(%L, 'delivered') $$, tests.id('o_ready')), '42501', 'NOT_ALLOWED',
  'the previous driver can no longer deliver it');
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'driver', false) $$, tests.id('d1')),
  'after the hand-over the old driver can be deactivated');
select throws_ok(format($$ select public.assign_driver(%L, %L) $$, tests.id('o_ready'), tests.id('d1')), 'P0001', 'DRIVER_NOT_FOUND',
  'cannot reassign to an inactive driver');
select tests.as_user(tests.id('d2'));
select lives_ok(format($$ select public.set_order_status(%L, 'delivered') $$, tests.id('o_ready')), 'the new driver delivers');
select tests.as_postgres();

-- ================================================================ 6) الإلغاء بلا إرجاع (البضاعة مع السائق)
select tests.remember('p_disp', tests.new_product(1500, 10, true, 1000));
select tests.remember('o_disp', tests.place(tests.new_user('customer'), jsonb_build_array(tests.item(tests.id('p_disp'), 3))));
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o_disp'), 'preparing');
select public.assign_driver(tests.id('o_disp'), tests.id('d2'));
select public.set_order_status(tests.id('o_disp'), 'ready');
select public.set_order_status(tests.id('o_disp'), 'out_for_delivery');
select tests.as_postgres();
update public.product_costs set cost_iqd = 1250 where product_id = tests.id('p_disp');  -- الكلفة تغيّرت بعد الطلب
select set_config('t.waste_before', coalesce((select waste_cost_iqd from public.daily_stats where day = public.baghdad_today()), 0)::text, true);

select tests.as_user(tests.id('staff'));
select throws_ok(format($$ select public.set_order_status(%L, 'cancelled', 'x', false) $$, tests.id('o_disp')), '42501', 'NOT_ALLOWED',
  'staff cannot cancel without return');
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.set_order_status(%L, 'delivered', null, false) $$, tests.id('o_disp')), 'P0001', 'INVALID_REQUEST',
  'p_return_stock = false only for a cancel');
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled', 'الزبون ما استلم', false) $$, tests.id('o_disp')),
  'admin cancels an out_for_delivery order without returning stock');
select tests.as_postgres();
select is((select qty from public.stock where product_id = tests.id('p_disp')), 7, 'stock not returned (10 - 3)');
select results_eq(
  format($$ select type::text, qty, unit_cost_iqd, note from public.inventory_movements
             where order_id = %L and type in ('cancel_return', 'waste') order by id $$, tests.id('o_disp')),
  $$ values ('cancel_return'::text, 3, 1250::bigint, 'إلغاء طلب بعد خروجه (بلا إرجاع)'::text),
            ('waste'::text, -3, 1000::bigint, 'cancelled after dispatch: أُلغي بعد خروجه مع السائق'::text) $$,
  'cancel_return + waste rows: the waste is valued at the order-time cost');
select is((select sum(qty)::int from public.inventory_movements where product_id = tests.id('p_disp')), 7,
  'ledger still equals stock');
select is((select waste_cost_iqd from public.daily_stats where day = public.baghdad_today())
          - current_setting('t.waste_before')::bigint, 3000::bigint, 'waste cost booked today (3 × 1000)');

-- الإلغاء العادي يرجع المخزون
select tests.remember('p_norm', tests.new_product(1000, 10));
select tests.remember('o_norm', tests.place(tests.new_user('customer'), jsonb_build_array(tests.item(tests.id('p_norm'), 2))));
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o_norm'), 'preparing');
select public.assign_driver(tests.id('o_norm'), tests.id('d2'));
select public.set_order_status(tests.id('o_norm'), 'ready');
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.set_order_status(%L, 'cancelled', null, false) $$, tests.id('o_norm')), 'P0001', 'INVALID_REQUEST',
  'no "without return" before the order left (ready)');
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled') $$, tests.id('o_norm')), 'normal cancel');
select tests.as_postgres();
select is((select qty from public.stock where product_id = tests.id('p_norm')), 10, 'normal cancel returns the stock');
select is_empty(format($$ select 1 from public.inventory_movements where order_id = %L and type = 'waste' $$, tests.id('o_norm')),
  'normal cancel writes no waste');

-- ================================================================ 7) إشعار "جاهز" للسائقين مرة واحدة
select tests.remember('o_once', tests.order_in('preparing'));
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o_once'), 'ready');
select tests.as_postgres();
select is((select count(*)::int from public.notification_outbox where audience = 'drivers'
            and data ->> 'order_id' = tests.id('o_once')::text and data ->> 'type' = 'new_order'), 1,
  'ready → exactly one new_order row for the drivers');
select tests.set_uid(tests.id('d2'));
select public.accept_order(tests.id('o_once'));
select tests.set_uid(tests.id('admin'));
select public.assign_driver(tests.id('o_once'), tests.id('d2'));
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.set_order_status(%L, 'ready') $$, tests.id('o_once')), 'P0001', 'INVALID_TRANSITION',
  'ready cannot be entered twice');
select tests.as_postgres();
select is((select count(*)::int from public.notification_outbox where audience = 'drivers'
            and data ->> 'order_id' = tests.id('o_once')::text), 1,
  'accept / assign / a repeated ready add no driver broadcast');

-- ================================================================ 8) تدقيق الإعدادات
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.update_app_settings(jsonb_build_object('delivery_fee_iqd', %s + 250, 'store_open', %L::boolean)) $$,
  (select delivery_fee_iqd from public.app_settings where id = 1), (select store_open from public.app_settings where id = 1)),
  'change the fee (store_open sent unchanged)');
select tests.as_postgres();
select is((select jsonb_object_keys(after) from public.admin_audit where action = 'settings' and actor = tests.id('admin')),
  'delivery_fee_iqd', 'settings audit keeps only the changed field');
select is((select (after ->> 'delivery_fee_iqd')::bigint - (before ->> 'delivery_fee_iqd')::bigint from public.admin_audit
            where action = 'settings' and actor = tests.id('admin')), 250::bigint, 'old → new value');
select tests.as_user(tests.id('admin'));
select lives_ok($$ select public.update_app_settings(jsonb_build_object('delivery_fee_iqd', 1000.0)) $$,
  '1000.0 is accepted (numeric cast)');
select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.admin_audit), 0, 'staff reads no audit rows');
select tests.as_postgres();

select * from finish();
