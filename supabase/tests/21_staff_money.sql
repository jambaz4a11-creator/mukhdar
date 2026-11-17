-- 21: ماذا يرى الموظف من المبالغ (قرار المالك 2026-11-16، مراجعة T16-T19 M2).
--   يرى: مبالغ البيع اللازمة للإيصال (إجمالي الطلب وأجرته وبنوده، سعر البيع، أجرة التوصيل والحد الأدنى).
--   لا يرى: الكلفة، الربح، قيمة الهدر، كلفة حركات المخزون، التقارير، الإعدادات (تعديلاً).
-- أي عمود مبالغ جديد يُفشل الاختبار الأول حتى يُصنَّف هنا (بيع للموظف أو للأدمن فقط).
select plan(38);

-- ---------------------------------------------------------------- 1) قائمة أعمدة المبالغ مثبّتة
select set_eq(
  $$ select (table_name::text || '.' || column_name::text) collate "default"
       from information_schema.columns
      where table_schema = 'public' and (column_name::text collate "C") ~ '(_iqd|cost|profit|revenue|price|fees?)' $$,
  $$ values
     ('app_settings.delivery_fee_iqd'), ('app_settings.min_order_iqd'),
     -- T23 F M3: حدّا قيمة الطلب (مبالغ بيع، عامة مثل الحد الأدنى: الزبون والموظف يقرآنها)
     ('app_settings.max_order_iqd'), ('app_settings.new_account_max_order_iqd'),
     ('daily_stats.adjust_loss_iqd'), ('daily_stats.cost_iqd'), ('daily_stats.delivery_fees_iqd'),
     ('daily_stats.gross_profit_iqd'), ('daily_stats.net_profit_iqd'), ('daily_stats.revenue_iqd'),
     ('daily_stats.waste_cost_iqd'),
     ('inventory_movements.unit_cost_iqd'),
     ('order_item_costs.cost_snapshot_iqd'),
     ('order_items.line_total_iqd'), ('order_items.price_snapshot_iqd'),
     ('orders.delivery_fee_iqd'), ('orders.subtotal_iqd'), ('orders.total_iqd'),
     ('product_costs.cost_iqd'),
     ('products.price_iqd') $$,
  'every money column is classified below (new column = decide staff or admin-only)');

-- ---------------------------------------------------------------- التجهيز
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('p', tests.new_product(2000, 20, true, 1500));
select tests.remember('cust', tests.new_user('customer'));
select tests.remember('o', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p'), 2))));
select tests.remember('admin', tests.new_user('admin'));
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o'), 'preparing');
select public.assign_driver(tests.id('o'), tests.new_user('driver'));
select public.set_order_status(tests.id('o'), 'ready');
select public.set_order_status(tests.id('o'), 'out_for_delivery');
select public.set_order_status(tests.id('o'), 'delivered');
select public.adjust_stock(tests.id('p'), -1, 'waste', 'ذبلان');
select tests.set_uid(tests.id('cust'));
select public.rate_order(tests.id('o'), 4, 'جيد');
select tests.as_postgres();

-- ---------------------------------------------------------------- 2) مبالغ البيع: يراها (الإيصال)
select tests.as_user(tests.id('staff'));
select isnt_empty(format($$ select 1 from public.orders where id = %L and subtotal_iqd > 0 and total_iqd > 0
  and delivery_fee_iqd is not null $$, tests.id('o')), 'staff reads orders.subtotal/total/delivery_fee');
select isnt_empty(format($$ select 1 from public.order_items where order_id = %L and price_snapshot_iqd = 2000
  and line_total_iqd = 4000 $$, tests.id('o')), 'staff reads item prices and line totals');
select isnt_empty(format($$ select 1 from public.products where id = %L and price_iqd = 2000 $$, tests.id('p')),
  'staff reads the sale price');
select isnt_empty($$ select 1 from public.app_settings where delivery_fee_iqd is not null and min_order_iqd is not null
                      and max_order_iqd is not null and new_account_max_order_iqd is not null $$,
  'staff reads delivery fee and minimum (public, customers see them too)');

-- ---------------------------------------------------------------- 3) الكلفة والربح والهدر: لا
select is_empty($$ select 1 from public.product_costs $$, 'no product_costs (cost)');
select is_empty($$ select 1 from public.order_item_costs $$, 'no order_item_costs (cost at sale)');
select is_empty($$ select 1 from public.inventory_movements $$, 'no inventory_movements (unit cost, waste value)');
select is_empty($$ select 1 from public.daily_stats $$, 'no daily_stats (revenue, profit, waste cost: reports)');
select is_empty($$ select 1 from public.admin_audit $$, 'no admin_audit (settings history)');

-- ---------------------------------------------------------------- 4) دوال المبالغ والإعدادات: لا
select throws_ok($$ select public.update_app_settings('{"delivery_fee_iqd": 1000}') $$, '42501', 'NOT_ALLOWED',
  'no update_app_settings');
select throws_ok($$ select public.stuck_notifications_count() $$, '42501', 'NOT_ALLOWED', 'no stuck_notifications_count');
select throws_ok($$ select public.recompute_daily_stats(current_date, current_date) $$, '42501', 'NOT_ALLOWED',
  'no recompute_daily_stats');
select throws_ok(format($$ select public.adjust_stock(%L, -1, 'waste') $$, tests.id('p')), '42501', 'NOT_ALLOWED',
  'no waste entry (adjust_stock)');
select throws_ok(format($$ select public.adjust_stock(%L, 5, 'purchase', null, 1500) $$, tests.id('p')), '42501', 'NOT_ALLOWED',
  'no purchase entry (purchase cost)');
select throws_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'cost_iqd', 1000)) $$, tests.id('p')),
  '42501', 'NOT_ALLOWED', 'no admin_save_product (cost)');
select throws_ok(format($$ select public.set_product_price(%L, 2500) $$, tests.id('p')), '42501', 'NOT_ALLOWED',
  'no set_product_price');
select throws_ok($$ select * from public.available_orders() $$, '42501', 'NOT_ALLOWED', 'available_orders is for drivers');
-- التقارير (T20): أدمن فقط، كل الدوال الست
select throws_ok($$ select public.report_summary(current_date - 7, current_date) $$, '42501', 'NOT_ALLOWED',
  'no report_summary (sales, profit, waste)');
select throws_ok($$ select * from public.report_daily(current_date - 7, current_date) $$, '42501', 'NOT_ALLOWED',
  'no report_daily');
select throws_ok($$ select * from public.report_orders_placed(current_date - 7, current_date) $$, '42501', 'NOT_ALLOWED',
  'no report_orders_placed (reports page is admin-only)');
select throws_ok($$ select * from public.report_top_products(current_date - 7, current_date) $$, '42501', 'NOT_ALLOWED',
  'no report_top_products (sales and cost per product)');
select throws_ok($$ select * from public.report_drivers(current_date - 7, current_date) $$, '42501', 'NOT_ALLOWED',
  'no report_drivers');
select throws_ok($$ select * from public.report_waste(current_date - 7, current_date) $$, '42501', 'NOT_ALLOWED',
  'no report_waste (waste and shortage cost)');
-- الرئيسية (T25): الموظف يستدعيها لكن كل المال null بالدالة نفسها (لا بالواجهة)، والأدمن يراه
select is(
  (select count(*)::int from jsonb_each(public.dashboard_today()) e(k, v)
    where k in ('sales_iqd', 'sales_prev_iqd', 'avg_order_iqd', 'avg_order_prev_iqd', 'waste_cost_iqd',
                'net_profit_iqd', 'net_profit_prev_iqd', 'stuck_notifications') and jsonb_typeof(v) = 'null'),
  8, 'dashboard_today: all 7 money fields and the admin-only stuck-notifications count are null for staff');
select ok((public.dashboard_today() ->> 'delivered_count')::int >= 1 and (public.dashboard_today() -> 'open') is not null,
  'dashboard_today: staff still gets the counts (delivered today, open orders)');
-- بنيوي (مراجعة C M3): أي مفتاح جديد بالـ JSON يُفشل الاختبار حتى يُصنَّف، وأي مفتاح مالي غير null للموظف يُفشله
select set_eq(
  $$ select jsonb_object_keys(public.dashboard_today())::text collate "default" $$,
  $$ values ('day'), ('as_of'), ('delivered_count'), ('delivered_count_prev'), ('cancelled_count'),
             ('cancelled_count_prev'), ('placed_count'), ('placed_count_prev'), ('open'), ('low_stock_count'),
             ('low_stock_items'), ('sales_iqd'), ('sales_prev_iqd'), ('avg_order_iqd'), ('avg_order_prev_iqd'),
             ('waste_cost_iqd'), ('net_profit_iqd'), ('net_profit_prev_iqd'), ('stuck_notifications') $$,
  'dashboard_today: the key list is reviewed (a new key must be classified here: staff-safe or money)');
select is(
  (with recursive t(k, v) as (
     select e.key, e.value from jsonb_each(public.dashboard_today()) e
     union all
     select e.key, e.value from t, jsonb_each(case when jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end) e)
   select count(*)::int from t
    where (k collate "C") ~ '(_iqd|cost|profit|revenue|sales|fee|waste|price|stuck)' and jsonb_typeof(v) <> 'null'),
  0, 'dashboard_today: no money-like key (at any depth) carries a value for staff');
select ok(public.dashboard_today()::text !~ '(cost|profit)_iqd"s*:s*[0-9-]',
  'dashboard_today: no cost or profit number in the staff payload');
-- التقييمات (T26): بلا مبالغ، والمفاتيح مثبّتة
select set_eq(
  $$ select jsonb_object_keys(public.ratings_summary())::text collate "default" $$,
  $$ values ('count'), ('avg'), ('distribution') $$,
  'ratings_summary: reviewed key list (stars only, no money)');
select isnt_empty($$ select 1 from public.ratings_list() $$, 'staff can list ratings');
select is(
  (select count(*)::int from public.ratings_list() r, jsonb_object_keys(to_jsonb(r)) k
    where (k collate "C") ~ '(_iqd|cost|profit|revenue|sales|fee|waste|price|total|subtotal)'),
  0, 'ratings_list: no money column in any row');
select throws_ok(format($$ update public.app_settings set delivery_fee_iqd = 1000 where id = 1 $$), '42501', null,
  'no direct settings write');

-- ---------------------------------------------------------------- 5) RPCs executable by authenticated that return money
select tests.as_postgres();
select set_eq(
  $$ select p.proname::text collate "default" from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and has_function_privilege('authenticated', p.oid, 'execute')
        and (pg_get_function_result(p.oid) ~ '(_iqd|cost|profit|revenue|price)'
             or pg_get_function_result(p.oid) in ('orders', 'app_settings', 'daily_stats', 'products')) $$,
  $$ values ('accept_order'), ('assign_driver'), ('available_orders'), ('set_order_status'), ('update_app_settings'),
            ('report_daily'), ('report_drivers'), ('report_top_products'), ('report_waste') $$,
  'RPCs returning money-bearing rows: order rows (sale amounts), settings and reports (admin only, section 4)');
select set_eq(
  $$ select p.proname::text collate "default" from pg_proc p where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('authenticated', p.oid, 'execute')
       and (pg_get_function_result(p.oid) ~ '(cost|profit|revenue|waste)' or p.proname::text like 'report\_%') $$,
  $$ values ('report_daily'), ('report_drivers'), ('report_orders_placed'), ('report_summary'),
            ('report_top_products'), ('report_waste') $$,
  'the only authenticated RPCs that return cost, profit or waste are the report RPCs, refused to staff above');
-- مراجعة C M3: دوال تُرجع jsonb/record/TABLE لا يراها فحص أسماء النتائج أعلاه (نصها لا يحوي _iqd).
-- كل دالة جديدة من هذا النوع تُفشل الاختبار حتى تُصنَّف هنا (ومعها فحص بنيوي كما بـ dashboard_today).
select set_eq(
  $$ select p.proname::text collate "default" from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        and has_function_privilege('authenticated', p.oid, 'execute')
        and pg_get_function_result(p.oid) ~ '^(jsonb?|record|setof record|TABLE\()' $$,
  $$ values ('admin_cancel_customer_orders'), ('available_orders'), ('dashboard_today'), ('list_drivers'), ('place_order'), ('ratings_list'),
            ('ratings_summary'), ('report_daily'), ('report_drivers'), ('report_orders_placed'),
            ('report_summary'), ('report_top_products'), ('report_waste') $$,
  'every authenticated RPC returning jsonb / record / TABLE is reviewed (a new one must be classified here)');
select ok(not has_table_privilege('authenticated', 'public.daily_stats', 'insert, update, delete'),
  'daily_stats is not writable');
select ok(not has_table_privilege('authenticated', 'public.product_costs', 'insert, update, delete'),
  'product_costs is not writable directly');

select * from finish();
