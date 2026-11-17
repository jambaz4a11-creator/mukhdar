-- 18: المنتجات والمخزون (T18): دوال المنتجات وسحب الكتابة المباشرة، adjust_stock الجديدة،
-- adjust_stock_bulk (الذرية)، الكلفة والخسائر اليومية، إشعار النقص، recompute_daily_stats،
-- والثابت stock.qty = Σ الحركات. الكميات بوحدات البيع (أنصاف الكيلو) والمبالغ لكل وحدة.
select plan(72);

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('cust', tests.new_user('customer'));

create function tests.losses_today() returns table (w bigint, a bigint) language sql as $$
  select coalesce(sum(waste_cost_iqd), 0)::bigint, coalesce(sum(adjust_loss_iqd), 0)::bigint
    from public.daily_stats where day = public.baghdad_today()
$$;
create function tests.low_alerts(p_product uuid) returns int language sql as $$
  select count(*)::int from public.notification_outbox
   where data ->> 'type' = 'low_stock' and data ->> 'product_id' = p_product::text
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ================================================================ دوال المنتجات
select tests.as_user(tests.id('admin'));
select set_config('t.cat_id', (select id::text from public.categories order by id limit 1), true);

-- إنشاء منتج نص كيلو: "3000 / كيلو" باللوحة ← price_iqd = 1500
select tests.remember('np', public.admin_save_product(jsonb_build_object(
  'category_id', current_setting('t.cat_id')::int, 'name', 'T18 طماطة', 'unit', 'نص كيلو',
  'price_iqd', 1500, 'cost_iqd', 1000, 'low_stock_threshold', 8)));
select results_eq($$ select price_iqd, unit, is_active, in_stock from public.products where id = tests.id('np') $$,
  $$ values (1500::bigint, 'نص كيلو'::text, true, false) $$, 'admin_save_product creates a product (price per half kilo)');
select is((select cost_iqd from public.product_costs where product_id = tests.id('np')), 1000::bigint,
  'purchase price saved in the same transaction');
select results_eq($$ select qty, low_stock_threshold from public.stock where product_id = tests.id('np') $$,
  $$ values (0, 8) $$, 'stock row with the low-stock threshold');

select lives_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'price_iqd', 2000)) $$,
  tests.id('np')), 'edit with only the price');
select results_eq($$ select name, price_iqd from public.products where id = tests.id('np') $$,
  $$ values ('T18 طماطة'::text, 2000::bigint) $$, 'only the given fields change');
select is((select low_stock_threshold from public.stock where product_id = tests.id('np')), 8,
  'threshold untouched when absent');

select throws_ok($$ select public.admin_save_product(jsonb_build_object(
    'category_id', current_setting('t.cat_id')::int, 'name', 'x', 'unit', 'نص كيلو', 'price_iqd', 1100)) $$,
  'INVALID_PRODUCT', 'price 1100 is rejected by the database');
select throws_ok($$ select public.admin_save_product(jsonb_build_object(
    'category_id', current_setting('t.cat_id')::int, 'name', 'x', 'unit', 'كيلو', 'price_iqd', 1000)) $$,
  'INVALID_PRODUCT', 'unit outside SALE_UNITS is rejected');
select throws_ok($$ select public.admin_save_product(jsonb_build_object(
    'category_id', current_setting('t.cat_id')::int, 'unit', 'باقة', 'price_iqd', 250)) $$,
  'INVALID_PRODUCT', 'a new product needs a name');
select throws_ok($$ select public.admin_save_product(jsonb_build_object(
    'category_id', -1, 'name', 'x', 'unit', 'باقة', 'price_iqd', 250)) $$,
  'INVALID_PRODUCT', 'unknown category');
select throws_ok($$ select public.admin_save_product(jsonb_build_object('id', gen_random_uuid()::text, 'price_iqd', 250)) $$,
  'PRODUCT_NOT_FOUND', 'editing an unknown product');
select throws_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'cost_iqd', 1100)) $$,
  tests.id('np')), 'INVALID_PRODUCT', 'purchase price must be a multiple of 250');
select throws_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'low_stock_threshold', -1)) $$,
  tests.id('np')), 'INVALID_PRODUCT', 'threshold out of range');

-- التعديل السريع للسعر
select lives_ok(format($$ select public.set_product_price(%L, 1250) $$, tests.id('np')), 'quick price edit');
select is((select price_iqd from public.products where id = tests.id('np')), 1250::bigint, 'price updated');
select throws_ok(format($$ select public.set_product_price(%L, 1100) $$, tests.id('np')),
  'INVALID_PRODUCT', 'quick edit rejects a price not a multiple of 250');
select throws_ok($$ select public.set_product_price(gen_random_uuid(), 1000) $$, 'PRODUCT_NOT_FOUND',
  'quick edit of an unknown product');

-- الترتيب
select tests.as_postgres();
select tests.remember('r1', tests.new_product(500, 0));
select tests.remember('r2', tests.new_product(500, 0));
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.reorder_products(array[%L, %L, %L]::uuid[]) $$,
  tests.id('r2'), tests.id('np'), tests.id('r1')), 'reorder');
select results_eq($$ select sort_order from public.products where id in (tests.id('r2'), tests.id('np'), tests.id('r1'))
                     order by sort_order $$, $$ values (1), (2), (3) $$, 'sort_order follows the list');
select is((select sort_order from public.products where id = tests.id('r2')), 1, 'first in the list gets 1');
select throws_ok(format($$ select public.reorder_products(array[%L, gen_random_uuid()]::uuid[]) $$, tests.id('r1')),
  'PRODUCT_NOT_FOUND', 'reorder with an unknown product fails');
select throws_ok(format($$ select public.reorder_products(array[%L, %L]::uuid[]) $$, tests.id('r1'), tests.id('r1')),
  'INVALID_PRODUCT', 'reorder rejects duplicates');

-- الإخفاء: يختفي من تطبيق الزبون
select lives_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'is_active', false)) $$,
  tests.id('r1')), 'hide a product');
select tests.as_anon();
select is_empty($$ select 1 from public.products where id = tests.id('r1') $$, 'hidden product is invisible to anon');

-- سحب الكتابة المباشرة
select tests.as_user(tests.id('admin'));
select throws_ok($$ insert into public.products (category_id, name, unit, price_iqd)
                    values (current_setting('t.cat_id')::int, 'direct', 'باقة', 250) $$,
  '42501', null, 'admin cannot insert into products directly');
select throws_ok(format($$ update public.product_costs set cost_iqd = 1 where product_id = %L $$, tests.id('np')),
  '42501', null, 'admin cannot update product_costs directly');
select throws_ok(format($$ insert into public.product_costs (product_id, cost_iqd) values (%L, 250) $$, tests.id('r2')),
  '42501', null, 'admin cannot insert into product_costs directly');
select ok(not has_table_privilege('authenticated', 'public.products', 'insert')
          and not has_table_privilege('authenticated', 'public.products', 'update')
          and not has_table_privilege('authenticated', 'public.products', 'delete')
          and not has_column_privilege('authenticated', 'public.products', 'name', 'update')
          and not has_table_privilege('authenticated', 'public.product_costs', 'insert')
          and not has_table_privilege('authenticated', 'public.product_costs', 'update'),
  'no direct insert/update/delete grants on products or product_costs for authenticated');

-- غير الأدمن
select tests.as_user(tests.id('staff'));
select throws_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'price_iqd', 250)) $$,
  tests.id('np')), 'NOT_ALLOWED', 'staff cannot save a product');
select throws_ok(format($$ select public.set_product_price(%L, 250) $$, tests.id('np')), 'NOT_ALLOWED',
  'staff cannot change a price');
select throws_ok(format($$ select public.reorder_products(array[%L]::uuid[]) $$, tests.id('np')), 'NOT_ALLOWED',
  'staff cannot reorder');
select throws_ok(format($$ select public.adjust_stock_bulk(jsonb_build_array(jsonb_build_object('product_id', %L::text, 'qty', -1)), 'waste') $$,
  tests.id('np')), 'NOT_ALLOWED', 'staff cannot record waste');

-- ================================================================ adjust_stock: الكلفة والخسائر
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.adjust_stock(%L, 5, 'purchase') $$, tests.id('np')),
  'INVALID_MOVEMENT', 'purchase needs a unit cost');
select throws_ok(format($$ select public.adjust_stock(%L, 5, 'purchase', null, 1100) $$, tests.id('np')),
  'INVALID_MOVEMENT', 'purchase unit cost must be a multiple of 250');
-- "2.5 كيلو" بسعر 1500 للوحدة ← +5 وحدات
select is(public.adjust_stock(tests.id('np'), 5, 'purchase', null, 1500), 5, 'purchase +5 units (2.5 kg)');
select is((select in_stock from public.products where id = tests.id('np')), true, 'purchase makes it in_stock');
select is((select cost_iqd from public.product_costs where product_id = tests.id('np')), 1500::bigint,
  'purchase sets the current purchase price');
select is((select unit_cost_iqd from public.inventory_movements where product_id = tests.id('np') and type = 'purchase'),
  1500::bigint, 'the movement keeps its unit cost');
select lives_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'cost_iqd', 2000)) $$,
  tests.id('np')), 'manual purchase price correction');
select is((select unit_cost_iqd from public.inventory_movements where product_id = tests.id('np') and type = 'purchase'),
  1500::bigint, 'changing the purchase price later does not change old movements');

select throws_ok(format($$ select public.adjust_stock(%L, -1, 'adjust') $$, tests.id('np')),
  'INVALID_MOVEMENT', 'stock count adjustment needs a note');

select set_config('t.w0', (select w::text from tests.losses_today()), true);
select set_config('t.a0', (select a::text from tests.losses_today()), true);
select is(public.adjust_stock(tests.id('np'), -2, 'waste'), 3, 'waste -2');
select is((select w from tests.losses_today()) - current_setting('t.w0')::bigint, 4000::bigint,
  'waste adds qty x current purchase price (2 x 2000) to today''s waste cost');
select is(public.adjust_stock(tests.id('np'), -1, 'adjust', 'جرد'), 2, 'adjust -1');
select is((select a from tests.losses_today()) - current_setting('t.a0')::bigint, 2000::bigint,
  'negative adjustment adds to today''s adjustment loss');
select is(public.adjust_stock(tests.id('np'), 1, 'adjust', 'جرد'), 3, 'adjust +1');
select is((select a from tests.losses_today()) - current_setting('t.a0')::bigint, 2000::bigint,
  'positive adjustment is not a loss');
select is((select count(*)::int from public.daily_stats
            where net_profit_iqd <> gross_profit_iqd - waste_cost_iqd - adjust_loss_iqd), 0,
  'net_profit = gross_profit - waste - adjustment loss');

-- ================================================================ adjust_stock_bulk (هدر اليوم)
select tests.as_postgres();
select tests.remember('w1', tests.new_product(1000, 10, true, 500));
select tests.remember('w2', tests.new_product(1000, 10, true, 750));
select tests.remember('w3', tests.new_product(1000, 10, true, 250));
select tests.remember('w4', tests.new_product(1000, 10, true, null));
select tests.as_user(tests.id('admin'));
select set_config('t.w0', (select w::text from tests.losses_today()), true);

select throws_ok(format($$ select public.adjust_stock_bulk(jsonb_build_array(
    jsonb_build_object('product_id', %L::text, 'qty', -1),
    jsonb_build_object('product_id', %L::text, 'qty', -11)), 'waste') $$, tests.id('w1'), tests.id('w2')),
  'INSUFFICIENT_STOCK', 'one bad line fails the whole batch');
select results_eq($$ select qty from public.stock where product_id in (tests.id('w1'), tests.id('w2')) order by qty $$,
  $$ values (10), (10) $$, 'nothing was saved from the failed batch');
select throws_ok(format($$ select public.adjust_stock_bulk(jsonb_build_array(
    jsonb_build_object('product_id', %L::text, 'qty', -1),
    jsonb_build_object('product_id', %L::text, 'qty', -2)), 'waste') $$, tests.id('w1'), tests.id('w1')),
  'INVALID_MOVEMENT', 'duplicate product in a batch');
select throws_ok(format($$ select public.adjust_stock_bulk(jsonb_build_array(
    jsonb_build_object('product_id', %L::text, 'qty', 1)), 'waste') $$, tests.id('w1')),
  'INVALID_MOVEMENT', 'positive waste in a batch');
select throws_ok($$ select public.adjust_stock_bulk('{}'::jsonb, 'waste') $$, 'INVALID_MOVEMENT', 'not an array');

select is(public.adjust_stock_bulk(jsonb_build_array(
    jsonb_build_object('product_id', tests.id('w1')::text, 'qty', -2),
    jsonb_build_object('product_id', tests.id('w2')::text, 'qty', -1),
    jsonb_build_object('product_id', tests.id('w3')::text, 'qty', -4),
    jsonb_build_object('product_id', tests.id('w4')::text, 'qty', -3)), 'waste', 'هدر اليوم'),
  4, 'waste for 4 products in one save');
select results_eq($$ select qty from public.stock
                     where product_id in (tests.id('w1'), tests.id('w2'), tests.id('w3'), tests.id('w4'))
                     order by qty $$, $$ values (6), (7), (8), (9) $$, 'every stock decreased');
select is((select w from tests.losses_today()) - current_setting('t.w0')::bigint,
  (2 * 500 + 1 * 750 + 4 * 250 + 3 * 0)::bigint, 'today''s waste cost grows by exactly the batch cost');

select is(public.adjust_stock_bulk(jsonb_build_array(
    jsonb_build_object('product_id', tests.id('w4')::text, 'qty', 4, 'unit_cost_iqd', 1250)), 'purchase'),
  1, 'bulk purchase with a unit cost');
select is((select cost_iqd from public.product_costs where product_id = tests.id('w4')), 1250::bigint,
  'bulk purchase sets the purchase price');

-- ================================================================ إشعار النقص (للأدمن فقط، مرة عند العبور)
select tests.as_postgres();
select tests.remember('low', tests.new_product(500, 10));   -- الحد الافتراضي 5
select tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('low'), 6)));  -- 10 ← 4
select is(tests.low_alerts(tests.id('low')), 1, 'a sale crossing below the threshold writes one alert');
select is((select audience from public.notification_outbox
            where data ->> 'type' = 'low_stock' and data ->> 'product_id' = tests.id('low')::text),
  'admins_only', 'the alert goes to admins only');
select tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('low'), 1)));  -- 4 ← 3
select is(tests.low_alerts(tests.id('low')), 1, 'a second sale below the threshold does not repeat it');
select tests.set_uid(tests.id('admin'));
select public.adjust_stock(tests.id('low'), 5, 'purchase', null, 250);   -- 3 ← 8
select public.adjust_stock(tests.id('low'), -4, 'waste');                -- 8 ← 4
select is(tests.low_alerts(tests.id('low')), 2, 'back above the threshold then below again: a new alert');

-- المستلمون: الأدمن نعم، الموظف لا
insert into public.push_tokens (user_id, token, platform, session_id)
values (tests.id('admin'), 'ExponentPushToken[t18-admin]', 'ios', tests.panel_session(tests.id('admin'))),
       (tests.id('staff'), 'ExponentPushToken[t18-staff]', 'ios', tests.panel_session(tests.id('staff')));
update public.notification_outbox set sent_at = now()
 where sent_at is null and not (data ->> 'type' = 'low_stock' and data ->> 'product_id' = tests.id('low')::text);
select tests.as_service();
select ok((select bool_and(recipients @> '[{"token": "ExponentPushToken[t18-admin]"}]'
                           and not recipients @> '[{"token": "ExponentPushToken[t18-staff]"}]')
             from public.claim_push_notifications(50)),
  'low-stock alerts reach admins, not staff');

-- ================================================================ recompute_daily_stats = التحديث التراكمي
select tests.as_postgres();
select tests.order_in('delivered');
select tests.order_in('cancelled');
create temp table t18_before as select * from public.daily_stats;
select private.rebuild_daily_stats(
  least((select min(day) from public.daily_stats), public.baghdad_today()), public.baghdad_today());
select is_empty($$
  (select day, delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd,
          waste_cost_iqd, adjust_loss_iqd from t18_before
    where (delivered_count, cancelled_count, waste_cost_iqd, adjust_loss_iqd) <> (0, 0, 0, 0)
   except
   select day, delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd,
          waste_cost_iqd, adjust_loss_iqd from public.daily_stats)
  union all
  (select day, delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd,
          waste_cost_iqd, adjust_loss_iqd from public.daily_stats
   except
   select day, delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd,
          waste_cost_iqd, adjust_loss_iqd from t18_before) $$,
  'rebuilding daily_stats from source equals the cumulative updates');

select tests.as_user(tests.id('staff'));
select throws_ok($$ select public.recompute_daily_stats(current_date - 1, current_date) $$, 'NOT_ALLOWED',
  'staff cannot recompute stats');
select tests.as_user(tests.id('admin'));
select throws_ok($$ select public.recompute_daily_stats(current_date, current_date - 1) $$, 'INVALID_DATE_RANGE',
  'from after to is rejected');
select throws_ok($$ select public.recompute_daily_stats(current_date - 400, current_date) $$, 'INVALID_DATE_RANGE',
  'more than a year is rejected');
select lives_ok($$ select public.recompute_daily_stats(public.baghdad_today() - 1, public.baghdad_today()) $$,
  'admin recomputes a range');
select tests.as_service();
select lives_ok($$ select public.recompute_daily_stats(current_date, current_date) $$,
  'service_role recomputes a range');

-- ================================================================ الثابت: الرصيد = مجموع الحركات
select tests.as_postgres();
select is_empty($$ select s.product_id from public.stock s
                    left join (select product_id, sum(qty)::int as net from public.inventory_movements
                                group by product_id) m on m.product_id = s.product_id
                   where s.qty <> coalesce(m.net, 0) $$,
  'stock.qty = sum of inventory movements for every product');

-- ================================================================ الأقسام: كتابة الأدمن فقط
select tests.as_user(tests.id('staff'));
select is(tests.affected($$ update public.categories set is_active = false where id = current_setting('t.cat_id')::int $$),
  0, 'staff cannot hide a category');
select tests.as_user(tests.id('admin'));
select is(tests.affected($$ update public.categories set image_path = 'categories/1/1.webp', sort_order = 3
                            where id = current_setting('t.cat_id')::int $$),
  1, 'admin updates a category image and order');

select * from finish();
