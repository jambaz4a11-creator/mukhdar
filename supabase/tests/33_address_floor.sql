-- 33: الطابق بالعنوان (migration 20261204000001): إلزامي لعنوان جديد من التطبيق، 0..20، لا يُمسح، يدخل لقطة
-- الطلب، ويُحذف بتجهيل الحساب. الكتابات بدور الزبون الحقيقي (قاعدة CLAUDE.md).
select plan(14);

select tests.remember('cust', tests.new_user('customer'));
select tests.remember('prod', tests.new_product(1000, 50));
-- عنوان قديم (قبل الطابق) بدور المالك، كما بقي على dev
select tests.remember('old', tests.new_address(tests.id('cust')));
select set_config('t.bld', (select building_id::text from public.addresses where id = tests.id('old')), true);
select is((select floor from public.addresses where id = tests.id('old')), null, 'old address: no floor (null allowed)');

select tests.as_user_aal1(tests.id('cust'));
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, apartment) values (%L, %s, '4') $$,
                        tests.id('cust'), current_setting('t.bld')), 'P0001', 'FLOOR_REQUIRED',
  'customer: a new address without a floor is refused (FLOOR_REQUIRED)');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 21, '4') $$,
                        tests.id('cust'), current_setting('t.bld')), '23514', null, 'floor above 20 is refused');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, -1, '4') $$,
                        tests.id('cust'), current_setting('t.bld')), '23514', null, 'negative floor is refused');
select lives_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 0, '4') $$,
                       tests.id('cust'), current_setting('t.bld')), 'customer: ground floor (0) is accepted');
select tests.remember('new', (select id from public.addresses where customer_id = tests.id('cust') and apartment = '4'));
select lives_ok(format($$ update public.addresses set apartment = '3A' where id = %L $$, tests.id('old')),
  'customer: an old address without a floor can still be edited');
select throws_ok(format($$ update public.addresses set floor = null where id = %L $$, tests.id('new')), 'P0001', 'FLOOR_REQUIRED',
  'customer: a saved floor cannot be cleared');
select lives_ok(format($$ update public.addresses set floor = 7 where id = %L $$, tests.id('new')),
  'customer: changes the floor');

-- اللقطة
select lives_ok(format($$ select tests.remember('o_new', (public.place_order(%L, %L::jsonb, gen_random_uuid()) ->> 'order_id')::uuid) $$,
                       tests.id('new'), jsonb_build_array(tests.item(tests.id('prod'), 1))), 'customer: orders to the new address');
select lives_ok(format($$ select tests.remember('o_old', (public.place_order(%L, %L::jsonb, gen_random_uuid()) ->> 'order_id')::uuid) $$,
                       tests.id('old'), jsonb_build_array(tests.item(tests.id('prod'), 1))), 'customer: orders to the old address');
select tests.as_postgres();
select is((select address_snapshot ->> 'floor' from public.orders where id = tests.id('o_new')), '7',
  'order snapshot keeps the floor at order time');
select ok(not ((select address_snapshot from public.orders where id = tests.id('o_old')) ? 'floor'),
  'old address without a floor: no floor key in the snapshot');

-- تجهيل الحساب يحذف الطابق
select tests.set_uid(tests.id('cust'));
select public.set_order_status(id, 'cancelled') from public.orders where customer_id = tests.id('cust');
select tests.as_postgres();
delete from auth.users where id = tests.id('cust');
select is((select address_snapshot from public.orders where id = tests.id('o_new')) ? 'floor', false,
  'deleted account: the floor is removed from the order snapshot');

select is(
  (select count(*)::int from pg_proc p
    where p.oid = 'private.tg_orders_snapshot_floor()'::regprocedure and p.prosecdef
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')),
  1, 'snapshot trigger is SECURITY DEFINER and not executable by any role');

select * from finish();
