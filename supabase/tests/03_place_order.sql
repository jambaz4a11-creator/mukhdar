-- 03: place_order
select plan(32);

-- التجهيز (postgres): إعدادات معروفة، منتجات، زبائن، عناوين
update public.app_settings set delivery_fee_iqd = 1000, min_order_iqd = 0, store_open = true;
select tests.remember('c1', tests.new_user('customer'));
select tests.remember('c2', tests.new_user('customer'));
select tests.remember('driver', tests.new_user('driver'));
select tests.remember('p1', tests.new_product(1250, 10, true, 800));
select tests.remember('p2', tests.new_product(750, 10));
select tests.remember('p_off', tests.new_product(500, 10, false));
select tests.remember('a1', tests.new_address(tests.id('c1')));
select tests.remember('a2', tests.new_address(tests.id('c2')));
select tests.remember('k1', 'aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- طلب صحيح
select tests.as_user(tests.id('c1'));

-- السعر المرسل (price_iqd: 1) يُتجاهل، و p1 المكرر يُدمج (1 + 1 = 2)
select isnt(
  tests.remember('o1', (public.place_order(tests.id('a1'), jsonb_build_array(
      jsonb_build_object('product_id', tests.id('p1'), 'qty', 1, 'price_iqd', 1),
      tests.item(tests.id('p2'), 3),
      tests.item(tests.id('p1'), 1)), tests.id('k1'), '  ') ->> 'order_id')::uuid),
  null, 'valid order is placed');

select row_eq($$ select subtotal_iqd, delivery_fee_iqd, total_iqd, status, note from public.orders where id = tests.id('o1') $$,
  row(4750::bigint, 1000::bigint, 5750::bigint, 'pending'::public.order_status, null::text),
  'totals come from the products table (2x1250 + 3x750 + fee 1000), blank note stored as null');

select results_eq($$ select qty, price_snapshot_iqd, line_total_iqd from public.order_items
                     where order_id = tests.id('o1') order by qty $$,
  $$ values (2, 1250::bigint, 2500::bigint), (3, 750::bigint, 2250::bigint) $$,
  'duplicate lines are merged; prices snapshotted from the table');

select is((select address_snapshot ->> 'apartment' from public.orders where id = tests.id('o1')), '3',
  'address snapshot is stored on the order');

-- منع التكرار: نفس المفتاح يرجع نفس الطلب حتى لو تغيرت السلة
select results_eq($$ select r ->> 'order_id', r ->> 'replayed'
                     from (select public.place_order(tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 1)),
                                                     tests.id('k1')) as r) x $$,
  $$ values (tests.id('o1')::text, 'true') $$, 'same idempotency key returns the same order (replayed)');
select is((select count(*)::int from public.orders where customer_id = tests.id('c1')), 1,
  'replay does not create a second order');

-- ---------------------------------------------------------------- الرفض
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 0))), 'INVALID_QTY', 'qty 0 is rejected');
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 100))), 'INVALID_QTY', 'qty 100 is rejected');
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 50), tests.item(tests.id('p2'), 50))),
  'INVALID_QTY', 'merged qty above 99 is rejected');
select throws_ok(format($$ select public.place_order(%L, '[]', gen_random_uuid()) $$, tests.id('a1')),
  'EMPTY_CART', 'empty cart is rejected');
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$, tests.id('a1'),
  (select jsonb_agg(tests.item(gen_random_uuid(), 1)) from generate_series(1, 51))),
  'TOO_MANY_ITEMS', 'more than 50 distinct items is rejected');
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p1'), 9))),
  'INSUFFICIENT_STOCK', 'qty above remaining stock (8) is rejected');
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p_off'), 1))),
  'PRODUCT_UNAVAILABLE', 'inactive product is rejected');
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(gen_random_uuid(), 1))),
  'PRODUCT_UNAVAILABLE', 'unknown product is rejected');
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a2'), jsonb_build_array(tests.item(tests.id('p2'), 1))),
  'ADDRESS_NOT_FOUND', 'another customer''s address is rejected');
select throws_ok(format($$ select public.place_order(%L, %L, null) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 1))),
  'IDEMPOTENCY_KEY_REQUIRED', 'missing idempotency key is rejected');

-- المتجر مغلق
select tests.as_postgres();
update public.app_settings set store_open = false;
select tests.as_user(tests.id('c1'));
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 1))), 'STORE_CLOSED', 'closed store rejects orders');

-- الحد الأدنى (يُقارن بالمجموع قبل الأجرة)
select tests.as_postgres();
update public.app_settings set store_open = true, min_order_iqd = 5000;
select tests.as_user(tests.id('c1'));
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 1))), 'BELOW_MIN_ORDER', 'subtotal below minimum is rejected');
select lives_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p1'), 4))), 'subtotal equal to minimum (5000) is accepted');

-- الأجرة الحالية تُنسخ للطلب
select tests.as_postgres();
update public.app_settings set min_order_iqd = 0, delivery_fee_iqd = 1500;
select tests.as_user(tests.id('c1'));
select is((public.place_order(tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 1)), gen_random_uuid())
           ->> 'total_iqd')::bigint, 2250::bigint, 'current delivery fee (1500) is applied');

-- من ليس زبوناً نشطاً
select tests.as_user(tests.id('driver'));
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 1))), 'NOT_CUSTOMER', 'a driver cannot place orders');
select tests.as_postgres();
update public.profiles set is_active = false where id = tests.id('c2');
select tests.as_user(tests.id('c2'));
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a2'), jsonb_build_array(tests.item(tests.id('p2'), 1))), 'NOT_CUSTOMER', 'a deactivated customer cannot order');
select tests.as_postgres();
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 1))), 'NOT_AUTHENTICATED', 'no JWT sub is rejected');
select tests.as_anon();
select throws_ok(format($$ select public.place_order(%L, %L, gen_random_uuid()) $$,
  tests.id('a1'), jsonb_build_array(tests.item(tests.id('p2'), 1))), '42501', null, 'anon cannot execute place_order');

-- ---------------------------------------------------------------- الآثار الجانبية (postgres)
select tests.as_postgres();
select is((select qty from public.stock where product_id = tests.id('p1')), 4, 'p1 stock: 10 - 2 - 4 = 4');
select is((select qty from public.stock where product_id = tests.id('p2')), 6, 'p2 stock: 10 - 3 - 1 = 6 (failed attempts rolled back)');
select results_eq($$ select qty, type::text from public.inventory_movements where order_id = tests.id('o1') order by qty $$,
  $$ values (-3, 'sale'), (-2, 'sale') $$, 'sale movements recorded for the order');
select results_eq($$ select i.qty, c.cost_snapshot_iqd from public.order_items i
                     join public.order_item_costs c on c.order_item_id = i.id
                     where i.order_id = tests.id('o1') order by i.qty $$,
  $$ values (2, 800::bigint), (3, 0::bigint) $$, 'cost snapshot per item (missing cost = 0)');
select results_eq($$ select audience from public.notification_outbox
                     where data ->> 'order_id' = tests.id('o1')::text order by audience $$,
  array['admins', 'drivers'], 'drivers and admins are notified');
select results_eq($$ select from_status::text, to_status::text from public.order_status_history where order_id = tests.id('o1') $$,
  $$ values (null::text, 'pending') $$, 'history row for creation');
select is((select customer_phone from public.orders where id = tests.id('o1')),
  (select phone from public.profiles where id = tests.id('c1')), 'customer phone snapshot on the order');
select is((select in_stock from public.products where id = tests.id('p1')), true, 'p1 still in stock');

select * from finish();
