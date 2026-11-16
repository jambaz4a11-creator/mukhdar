-- 02: RLS للكتالوج والعناوين والإعدادات (anon / customer / staff / admin)
select plan(39);

-- التجهيز (postgres)
select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('c1', tests.new_user('customer'));
select tests.remember('c2', tests.new_user('customer'));
select tests.remember('p_active', tests.new_product(1000, 5, true, 600));
select tests.remember('p_hidden', tests.new_product(2000, 5, false));
select tests.remember('a1', tests.new_address(tests.id('c1')));
select tests.remember('a2', tests.new_address(tests.id('c2')));
insert into public.sectors (name, is_active) values ('test-hidden-sector', false);

-- ---------------------------------------------------------------- anon
select tests.as_anon();
select isnt_empty($$ select 1 from public.products where id = tests.id('p_active') $$, 'anon sees active product');
select is_empty($$ select 1 from public.products where id = tests.id('p_hidden') $$, 'anon does not see inactive product');
select is((select count(*)::int from public.app_settings), 1, 'anon reads app_settings');
select isnt_empty($$ select 1 from public.sectors where name like 'test-sector%' $$,
  'anon reads active sectors (address picker)');
select is_empty($$ select 1 from public.sectors where name = 'test-hidden-sector' $$, 'anon does not see inactive sector');
select throws_ok($$ select * from public.stock $$, '42501', null, 'anon cannot read stock');
select throws_ok($$ select * from public.product_costs $$, '42501', null, 'anon cannot read product_costs');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ select * from public.addresses $$, '42501', null, 'anon cannot read addresses');
select throws_ok($$ insert into public.categories (name) values ('x') $$, '42501', null, 'anon cannot insert catalog rows');

-- ---------------------------------------------------------------- customer
select tests.as_user(tests.id('c1'));
select is_empty($$ select 1 from public.products where id = tests.id('p_hidden') $$, 'customer does not see inactive product');
select is_empty($$ select 1 from public.stock $$, 'customer sees no stock rows');
select is_empty($$ select 1 from public.product_costs $$, 'customer sees no product_costs');
select is_empty($$ select 1 from public.inventory_movements $$, 'customer sees no inventory_movements');
select is_empty($$ select 1 from public.daily_stats $$, 'customer sees no daily_stats');
select is_empty($$ select 1 from public.order_item_costs $$, 'customer sees no order_item_costs');
select throws_ok($$ insert into public.categories (name) values ('x') $$, '42501', null, 'customer cannot insert a category');
select throws_ok($$ update public.products set price_iqd = 250 where id = tests.id('p_active') $$,
  '42501', null, 'customer cannot update a product');
select throws_ok($$ delete from public.products where id = tests.id('p_active') $$,
  '42501', null, 'customer cannot delete a product');
select throws_ok($$ update public.app_settings set store_open = false $$,
  '42501', null, 'customer cannot update app_settings');
select results_eq($$ select id from public.addresses $$, array[tests.id('a1')], 'customer sees only own address');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, apartment)
                           select %L, building_id, '9' from public.addresses limit 1 $$, tests.id('c2')),
  '42501', null, 'customer cannot add an address for someone else');
select lives_ok($$ insert into public.addresses (customer_id, building_id, apartment)
                   select (select auth.uid()), building_id, '9' from public.addresses limit 1 $$,
  'customer can add own address');

-- ---------------------------------------------------------------- staff
select tests.as_user(tests.id('staff'));
select isnt_empty($$ select 1 from public.products where id = tests.id('p_hidden') $$, 'staff sees inactive product');
select isnt_empty($$ select 1 from public.stock where product_id = tests.id('p_active') $$, 'staff reads stock');
select is_empty($$ select 1 from public.product_costs $$, 'staff does not see product_costs');
select throws_ok($$ insert into public.categories (name) values ('x') $$, '42501', null, 'staff cannot insert a category');

-- ---------------------------------------------------------------- admin
select tests.as_user(tests.id('admin'));
select isnt_empty($$ select 1 from public.products where id = tests.id('p_hidden') $$, 'admin sees inactive product');
select isnt_empty($$ select 1 from public.sectors where name = 'test-hidden-sector' $$, 'admin sees inactive sector');
select results_eq($$ select cost_iqd from public.product_costs where product_id = tests.id('p_active') $$,
  array[600::bigint], 'admin reads product_costs');
select lives_ok($$ insert into public.categories (name) values ('test admin category') $$, 'admin inserts a category');
select throws_ok($$ update public.products set price_iqd = 1250 where id = tests.id('p_active') $$,
  '42501', null, 'even admin cannot update a product directly (functions only, T18)');
select throws_ok($$ update public.app_settings set delivery_fee_iqd = 1500 $$,
  '42501', null, 'even admin cannot update app_settings directly (update_app_settings, T19)');
select is((select delivery_fee_iqd from public.update_app_settings('{"delivery_fee_iqd": 1500}')), 1500::bigint,
  'admin updates settings through update_app_settings');
select throws_ok($$ select public.admin_save_product(jsonb_build_object(
                      'category_id', (select id from public.categories limit 1),
                      'name', 'bad price', 'unit', 'نص كيلو', 'price_iqd', 1100)) $$,
  'INVALID_PRODUCT', 'price not a multiple of 250 is rejected');
select throws_ok($$ select public.admin_save_product(jsonb_build_object(
                      'category_id', (select id from public.categories limit 1),
                      'name', 'free-text unit', 'unit', 'كيلو', 'price_iqd', 1000)) $$,
  'INVALID_PRODUCT', 'a unit outside the fixed list is rejected (S7)');
select throws_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'unit', 'نصف كيلو')) $$,
                        tests.id('p_active')),
  'INVALID_PRODUCT', 'changing a product to a free-text unit is rejected');
select is((select count(*)::int from unnest(array['نص كيلو', 'باقة', 'حبة', 'علبة', 'قنينة', 'سلة']) u
            where public.admin_save_product(jsonb_build_object(
                    'category_id', (select id from public.categories limit 1),
                    'name', 'unit ' || u, 'unit', u, 'price_iqd', 1000)) is not null),
  6, 'every allowed sale unit is accepted');
select results_eq($$ select count(*)::int from public.addresses where id in (tests.id('a1'), tests.id('a2')) $$,
  array[2], 'admin sees all customers'' addresses');

select * from finish();
