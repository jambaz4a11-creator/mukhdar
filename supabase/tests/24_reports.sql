-- 24: التقارير (T20). تجهيز بأرقام محسوبة يدوياً يجب أن تطابق بالضبط، بحدود يوم بغداد (23:30 و00:30).
--   المبيعات = subtotal المسلّمة بيوم delivered_at بلا الأجرة؛ الربح الإجمالي = المبيعات − الكلفة لحظة الطلب؛
--   صافي الربح = الإجمالي − الهدر − التسويات السالبة. الملغى لا يدخل إلا هدر "الإلغاء بلا إرجاع".
--   + أدمن فقط (الموظف والزبون والسائق والزائر والأدمن برمز مؤقت يُرفضون)، المدى ≤ 366 يوماً،
--   + L4(a): منتج له تاريخ لا يُحذف حذفاً فعلياً.
select plan(38);

-- ================================================================ التجهيز
-- المنتجات: P1 طماطة (نص كيلو) سعر 1500 كلفة 1000، رصيد 100؛ P2 نعناع (باقة) سعر 500 كلفة 250، رصيد 50.
-- الأجرة 1000. الطلبات (الأوقات بتوقيت بغداد بعد النقل؛ الأيام 2020-03-10..13 خالية من أي بيانات أخرى):
--   O1 P1×4 + P2×2 = 7000 (كلفة 4000 + 500 = 4500)، أنشئ 10 22:00، سُلّم 10 23:30، سائق D1، تقييم 5
--   O2 P1×2 = 3000 (كلفة 2000)، أنشئ 10 22:00، سُلّم 11 00:30، سائق D1، تقييم 4
--   O3 P1×3 أُلغي مع إرجاع المخزون (11 10:00): لا مبالغ
--   O4 P1×1 + P2×3 أُلغي بالطريق بلا إرجاع (11 12:00): هدر بكلفة الطلب 1000 + 750 = 1750
--   O5 P2×1 معلّق، أنشئ 12 23:30؛ O6 P2×1 معلّق، أنشئ 13 00:30
-- بعد إنشاء الطلبات: مشتريات P1 +10 بكلفة 1250 (11 08:00) ← الكلفة الحالية 1250 (لا تغيّر كلفة الطلبات).
-- هدر P1 −6 × 1250 = 7500 (12 09:00)؛ تسوية P2 −4 × 250 = 1000 (12 23:59)؛ تسوية P2 +1 (لا تُحسب)؛
-- هدر P2 −1 × 250 = 250 (13 00:30، خارج 10..12).
--
-- المتوقع لكل يوم:
--   10: واردة 2، مسلّمة 1، ملغاة 0، مبيعات 7000، أجرة 1000، كلفة 4500، إجمالي 2500، هدر 0، نقص 0، صافي 2500
--   11: واردة 2، مسلّمة 1، ملغاة 2، مبيعات 3000، أجرة 1000، كلفة 2000، إجمالي 1000، هدر 1750، نقص 0، صافي −750
--   12: واردة 1، 0، 0، 0، 0، 0، 0، هدر 7500، نقص 1000، صافي −8500
--   13: واردة 1، … هدر 250، صافي −250
--   10..12: واردة 5، مسلّمة 2، ملغاة 2، مبيعات 10000، أجرة 2000، كلفة 6500، إجمالي 3500، هدر 9250،
--           نقص 1000، صافي −6750، متوسط الطلب 5000، تقييمان بمتوسط 4.5
update public.app_settings set delivery_fee_iqd = 1000, min_order_iqd = 0, store_open = true;

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('cust',  tests.new_user('customer'));
select tests.remember('d1',    tests.new_user('driver', 'سائق واحد'));
select tests.remember('d2',    tests.new_user('driver', 'سائق اثنين'));
select tests.remember('p1', tests.new_product(1500, 100, true, 1000));
select tests.remember('p2', tests.new_product(500, 50, true, 250));
update public.products set name = 'طماطة T20' where id = tests.id('p1');
update public.products set name = 'نعناع T20', unit = 'باقة' where id = tests.id('p2');
select tests.remember('addr', tests.new_address(tests.id('cust')));

-- لقطة daily_stats لليوم قبل التجهيز (لفحص التحديث التراكمي)
create table tests.before as
  select coalesce((select to_jsonb(s) - 'day' - 'updated_at' from public.daily_stats s
                    where s.day = public.baghdad_today()), '{}') as snap;

select tests.remember('o1', tests.place(tests.id('cust'),
  jsonb_build_array(tests.item(tests.id('p1'), 4), tests.item(tests.id('p2'), 2)), tests.id('addr')));
select tests.remember('o2', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p1'), 2)), tests.id('addr')));
select tests.remember('o3', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p1'), 3)), tests.id('addr')));
select tests.remember('o4', tests.place(tests.id('cust'),
  jsonb_build_array(tests.item(tests.id('p1'), 1), tests.item(tests.id('p2'), 3)), tests.id('addr')));
select tests.remember('o5', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p2'), 1)), tests.id('addr')));
select tests.remember('o6', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p2'), 1)), tests.id('addr')));

select tests.set_uid(tests.id('admin'));
-- مشتريات بكلفة جديدة بعد الطلبات: الطلبات تبقى بكلفتها لحظة الطلب (1000)
select public.adjust_stock(tests.id('p1'), 10, 'purchase', null, 1250);

-- O1 وO2: مسلّمان بالسائق D1
select public.set_order_status(tests.id('o1'), 'preparing');
select public.assign_driver(tests.id('o1'), tests.id('d1'));
select public.set_order_status(tests.id('o1'), 'ready');
select public.set_order_status(tests.id('o1'), 'out_for_delivery');
select public.set_order_status(tests.id('o1'), 'delivered');
select public.set_order_status(tests.id('o2'), 'preparing');
select public.assign_driver(tests.id('o2'), tests.id('d1'));
select public.set_order_status(tests.id('o2'), 'ready');
select public.set_order_status(tests.id('o2'), 'out_for_delivery');
select public.set_order_status(tests.id('o2'), 'delivered');
-- O3: إلغاء مع إرجاع
select public.set_order_status(tests.id('o3'), 'preparing');
select public.set_order_status(tests.id('o3'), 'cancelled', 'الزبون ألغى');
-- O4: بالطريق مع D2 ثم إلغاء بلا إرجاع (البضاعة طلعت مع السائق)
select public.set_order_status(tests.id('o4'), 'preparing');
select public.assign_driver(tests.id('o4'), tests.id('d2'));
select public.set_order_status(tests.id('o4'), 'ready');
select public.set_order_status(tests.id('o4'), 'out_for_delivery');
select public.set_order_status(tests.id('o4'), 'cancelled', 'رفض الاستلام', false);
-- الهدر والجرد (كلفة P1 الحالية 1250، P2 250)
select public.adjust_stock(tests.id('p1'), -6, 'waste', 'هدر T20');
select public.adjust_stock(tests.id('p2'), -4, 'adjust', 'جرد نقص T20');
select public.adjust_stock(tests.id('p2'), 1, 'adjust', 'جرد زيادة T20');
select public.adjust_stock(tests.id('p2'), -1, 'waste', 'هدر T20 بعد منتصف الليل');
-- التقييمات (الزبون)
select tests.set_uid(tests.id('cust'));
select public.rate_order(tests.id('o1'), 5, 'ممتاز');
select public.rate_order(tests.id('o2'), 4, 'زين');
select tests.as_postgres();

-- ---------------------------------------------------------------- 1) التحديث التراكمي (كل شيء "اليوم")
select is(
  (select jsonb_build_object(
            'delivered', (a.snap ->> 'delivered_count')::int - coalesce((b.snap ->> 'delivered_count')::int, 0),
            'cancelled', (a.snap ->> 'cancelled_count')::int - coalesce((b.snap ->> 'cancelled_count')::int, 0),
            'sales',     (a.snap ->> 'revenue_iqd')::bigint - coalesce((b.snap ->> 'revenue_iqd')::bigint, 0),
            'fees',      (a.snap ->> 'delivery_fees_iqd')::bigint - coalesce((b.snap ->> 'delivery_fees_iqd')::bigint, 0),
            'cost',      (a.snap ->> 'cost_iqd')::bigint - coalesce((b.snap ->> 'cost_iqd')::bigint, 0),
            'gross',     (a.snap ->> 'gross_profit_iqd')::bigint - coalesce((b.snap ->> 'gross_profit_iqd')::bigint, 0),
            'waste',     (a.snap ->> 'waste_cost_iqd')::bigint - coalesce((b.snap ->> 'waste_cost_iqd')::bigint, 0),
            'shortage',  (a.snap ->> 'adjust_loss_iqd')::bigint - coalesce((b.snap ->> 'adjust_loss_iqd')::bigint, 0),
            'net',       (a.snap ->> 'net_profit_iqd')::bigint - coalesce((b.snap ->> 'net_profit_iqd')::bigint, 0))
     from tests.before b,
          (select to_jsonb(s) as snap from public.daily_stats s where s.day = public.baghdad_today()) a),
  '{"delivered": 2, "cancelled": 2, "sales": 10000, "fees": 2000, "cost": 6500, "gross": 3500,
    "waste": 9500, "shortage": 1000, "net": -7000}'::jsonb,
  'incremental daily_stats: sales without fee, cost at order time, waste incl. cancel-without-return, shortage');
select is((select qty from public.stock where product_id = tests.id('p1')), 97,
  'P1 stock: 100 - 10 ordered + 3 returned (O3) + 10 bought - 6 wasted; O4 (no return) not restocked');

-- ---------------------------------------------------------------- النقل لأيام 2020-03 (بغداد = UTC+3) وإعادة البناء
update public.orders set created_at = '2020-03-10 19:00Z' where id in (tests.id('o1'), tests.id('o2'));
update public.orders set delivered_at = '2020-03-10 20:30Z' where id = tests.id('o1');   -- 10 23:30
update public.orders set delivered_at = '2020-03-10 21:30Z' where id = tests.id('o2');   -- 11 00:30
update public.orders set created_at = '2020-03-11 06:00Z', cancelled_at = '2020-03-11 07:00Z' where id = tests.id('o3');
update public.orders set created_at = '2020-03-11 06:30Z', cancelled_at = '2020-03-11 09:00Z' where id = tests.id('o4');
update public.orders set created_at = '2020-03-12 20:30Z' where id = tests.id('o5');      -- 12 23:30
update public.orders set created_at = '2020-03-12 21:30Z' where id = tests.id('o6');      -- 13 00:30
update public.inventory_movements set created_at = '2020-03-11 09:00Z'
 where order_id = tests.id('o4') and type = 'waste';
update public.inventory_movements set created_at = '2020-03-11 05:00Z'
 where product_id = tests.id('p1') and type = 'purchase';
update public.inventory_movements set created_at = '2020-03-12 06:00Z'
 where product_id = tests.id('p1') and type = 'waste' and order_id is null;
update public.inventory_movements set created_at = '2020-03-12 20:59Z'                   -- 12 23:59
 where product_id = tests.id('p2') and type = 'adjust' and qty = -4;
update public.inventory_movements set created_at = '2020-03-12 10:00Z'
 where product_id = tests.id('p2') and type = 'adjust' and qty = 1;
update public.inventory_movements set created_at = '2020-03-12 21:30Z'                   -- 13 00:30
 where product_id = tests.id('p2') and type = 'waste' and order_id is null;
update public.ratings set created_at = '2020-03-10 20:45Z' where order_id = tests.id('o1');
update public.ratings set created_at = '2020-03-10 22:00Z' where order_id = tests.id('o2'); -- 11 01:00
select private.rebuild_daily_stats('2020-03-09', '2020-03-14');
select private.rebuild_daily_stats(public.baghdad_today(), public.baghdad_today());

select tests.as_user(tests.id('admin'));

-- ---------------------------------------------------------------- 2) لكل يوم
select is(
  (select jsonb_agg(to_jsonb(r) order by r.day) from public.report_daily('2020-03-10', '2020-03-13') r),
  '[{"day": "2020-03-10", "placed_count": 2, "delivered_count": 1, "cancelled_count": 0, "sales_iqd": 7000,
     "delivery_fees_iqd": 1000, "cost_iqd": 4500, "gross_profit_iqd": 2500, "waste_cost_iqd": 0,
     "adjust_loss_iqd": 0, "net_profit_iqd": 2500},
    {"day": "2020-03-11", "placed_count": 2, "delivered_count": 1, "cancelled_count": 2, "sales_iqd": 3000,
     "delivery_fees_iqd": 1000, "cost_iqd": 2000, "gross_profit_iqd": 1000, "waste_cost_iqd": 1750,
     "adjust_loss_iqd": 0, "net_profit_iqd": -750},
    {"day": "2020-03-12", "placed_count": 1, "delivered_count": 0, "cancelled_count": 0, "sales_iqd": 0,
     "delivery_fees_iqd": 0, "cost_iqd": 0, "gross_profit_iqd": 0, "waste_cost_iqd": 7500,
     "adjust_loss_iqd": 1000, "net_profit_iqd": -8500},
    {"day": "2020-03-13", "placed_count": 1, "delivered_count": 0, "cancelled_count": 0, "sales_iqd": 0,
     "delivery_fees_iqd": 0, "cost_iqd": 0, "gross_profit_iqd": 0, "waste_cost_iqd": 250,
     "adjust_loss_iqd": 0, "net_profit_iqd": -250}]'::jsonb,
  'report_daily: every Baghdad day exactly (23:30 delivery on the 10th, 00:30 on the 11th)');
select is((select count(*)::int from public.report_daily('2020-03-01', '2020-03-31')), 31,
  'report_daily returns every day of the range, zero-filled');

-- ---------------------------------------------------------------- 3) بطاقات المدى
select is(public.report_summary('2020-03-10', '2020-03-12'),
  '{"from": "2020-03-10", "to": "2020-03-12", "placed_count": 5, "delivered_count": 2, "cancelled_count": 2,
    "sales_iqd": 10000, "delivery_fees_iqd": 2000, "cost_iqd": 6500, "gross_profit_iqd": 3500,
    "waste_cost_iqd": 9250, "adjust_loss_iqd": 1000, "net_profit_iqd": -6750, "avg_order_iqd": 5000,
    "rating_count": 2, "rating_avg": 4.5}'::jsonb,
  'report_summary 10..12: hand-calculated totals match exactly');
select is(
  (select jsonb_build_object('sales', s -> 'sales_iqd', 'delivered', s -> 'delivered_count',
                             'ratings', s -> 'rating_count', 'avg', s -> 'avg_order_iqd')
     from public.report_summary('2020-03-10', '2020-03-10') s),
  '{"sales": 7000, "delivered": 1, "ratings": 1, "avg": 7000}'::jsonb,
  'day 10 alone: the 23:30 delivery is in, the 00:30 one is not');
select is(
  (select jsonb_build_object('sales', s -> 'sales_iqd', 'cancelled', s -> 'cancelled_count',
                             'waste', s -> 'waste_cost_iqd', 'net', s -> 'net_profit_iqd')
     from public.report_summary('2020-03-11', '2020-03-11') s),
  '{"sales": 3000, "cancelled": 2, "waste": 1750, "net": -750}'::jsonb,
  'day 11 alone: the 00:30 delivery belongs to the 11th; cancels add only the no-return waste');
select is((public.report_summary('2020-03-13', '2020-03-13') ->> 'avg_order_iqd'), null,
  'average order is null without deliveries (no division by zero)');
select is(
  (select (s ->> 'net_profit_iqd')::bigint = (s ->> 'sales_iqd')::bigint - (s ->> 'cost_iqd')::bigint
            - (s ->> 'waste_cost_iqd')::bigint - (s ->> 'adjust_loss_iqd')::bigint
     from public.report_summary('2020-03-10', '2020-03-13') s), true,
  'net profit = sales - COGS - waste - shortage (delivery fees excluded)');

-- ---------------------------------------------------------------- 4) الطلبات الواردة (created_at)
select is(
  (select jsonb_agg(to_jsonb(r) order by r.day) from public.report_orders_placed('2020-03-12', '2020-03-13') r),
  '[{"day": "2020-03-12", "placed_count": 1}, {"day": "2020-03-13", "placed_count": 1}]'::jsonb,
  'report_orders_placed: created 23:30 counts on the 12th, 00:30 on the 13th');

-- ---------------------------------------------------------------- 5) أكثر المنتجات مبيعاً
select is(
  (select jsonb_agg(jsonb_build_object('name', r.name, 'unit', r.unit, 'qty', r.qty, 'sales', r.sales_iqd,
                                       'cost', r.cost_iqd, 'gross', r.gross_profit_iqd) order by r.sales_iqd desc)
     from public.report_top_products('2020-03-10', '2020-03-12') r),
  '[{"name": "طماطة T20", "unit": "نص كيلو", "qty": 6, "sales": 9000, "cost": 6000, "gross": 3000},
    {"name": "نعناع T20", "unit": "باقة", "qty": 2, "sales": 1000, "cost": 500, "gross": 500}]'::jsonb,
  'report_top_products 10..12: delivered only (cancelled O3/O4 and pending O5/O6 excluded), cost at order time');
select is(
  (select jsonb_agg(jsonb_build_object('name', r.name, 'qty', r.qty, 'sales', r.sales_iqd))
     from public.report_top_products('2020-03-11', '2020-03-11') r),
  '[{"name": "طماطة T20", "qty": 2, "sales": 3000}]'::jsonb,
  'report_top_products day 11: only the 00:30 delivery');
select is((select count(*)::int from public.report_top_products('2020-03-10', '2020-03-12', 1)), 1,
  'p_limit caps the rows');
select is(
  (select jsonb_build_object('sales', sum(r.sales_iqd), 'cost', sum(r.cost_iqd))
     from public.report_top_products('2020-03-10', '2020-03-12', 100) r),
  (select jsonb_build_object('sales', s -> 'sales_iqd', 'cost', s -> 'cost_iqd')
     from public.report_summary('2020-03-10', '2020-03-12') s),
  'per-product sales and COGS add up to the summary (daily_stats)');

-- ---------------------------------------------------------------- 6) السائقون
select is(
  (select jsonb_agg(jsonb_build_object('name', r.name, 'n', r.delivered_count, 'fees', r.delivery_fees_iqd))
     from public.report_drivers('2020-03-10', '2020-03-12') r),
  '[{"name": "سائق واحد", "n": 2, "fees": 2000}]'::jsonb,
  'report_drivers: D1 delivered 2 (fees 2000); D2 only had the cancelled O4');
select is(
  (select jsonb_agg(jsonb_build_object('name', r.name, 'n', r.delivered_count))
     from public.report_drivers('2020-03-10', '2020-03-10') r),
  '[{"name": "سائق واحد", "n": 1}]'::jsonb,
  'report_drivers day 10: Baghdad day boundary');

-- ---------------------------------------------------------------- 7) تقرير الهدر
select is(
  (select jsonb_agg(jsonb_build_object('name', r.name, 'unit', r.unit, 'waste_qty', r.waste_qty,
                                       'waste_cost', r.waste_cost_iqd, 'shortage_qty', r.shortage_qty,
                                       'shortage_cost', r.shortage_cost_iqd, 'total', r.total_cost_iqd)
                    order by r.total_cost_iqd desc)
     from public.report_waste('2020-03-10', '2020-03-12') r),
  '[{"name": "طماطة T20", "unit": "نص كيلو", "waste_qty": 7, "waste_cost": 8500, "shortage_qty": 0,
     "shortage_cost": 0, "total": 8500},
    {"name": "نعناع T20", "unit": "باقة", "waste_qty": 3, "waste_cost": 750, "shortage_qty": 4,
     "shortage_cost": 1000, "total": 1750}]'::jsonb,
  'report_waste 10..12: 7 half-kilos of P1 (1 at order cost 1000 + 6 at 1250), P2 3 bunches + shortage 4; +1 adjust ignored');
select is(
  (select array_agg(r.name::text order by ord) from public.report_waste('2020-03-10', '2020-03-12')
     with ordinality as r(product_id, name, unit, wq, wc, sq, sc, t, ord)),
  array['طماطة T20', 'نعناع T20'], 'report_waste is ordered by cost');
select is(
  (select jsonb_build_object('waste', sum(r.waste_cost_iqd), 'shortage', sum(r.shortage_cost_iqd))
     from public.report_waste('2020-03-10', '2020-03-13') r),
  (select jsonb_build_object('waste', s -> 'waste_cost_iqd', 'shortage', s -> 'adjust_loss_iqd')
     from public.report_summary('2020-03-10', '2020-03-13') s),
  'report_waste adds up to the summary (incl. the 00:30 waste on the 13th)');
select is((select count(*)::int from public.report_waste('2020-03-13', '2020-03-13')), 1,
  'waste at 00:30 belongs to the next Baghdad day');

-- ---------------------------------------------------------------- 8) المدى
select throws_ok($$ select public.report_summary('2020-03-12', '2020-03-10') $$, 'P0001', 'INVALID_DATE_RANGE',
  'from after to is rejected');
select throws_ok($$ select public.report_summary('2020-01-01', '2021-01-01') $$, 'P0001', 'INVALID_DATE_RANGE',
  '367 days is rejected');
select lives_ok($$ select public.report_summary('2020-01-01', '2020-12-31') $$, '366 days is allowed');
select throws_ok($$ select * from public.report_waste(null, '2020-03-10') $$, 'P0001', 'INVALID_DATE_RANGE',
  'null bound is rejected');

-- ---------------------------------------------------------------- 9) أدمن فقط
select tests.as_user(tests.id('staff'));
select throws_ok($$ select public.report_summary('2020-03-10', '2020-03-12') $$, '42501', 'NOT_ALLOWED', 'staff: no report_summary');
select throws_ok($$ select * from public.report_daily('2020-03-10', '2020-03-12') $$, '42501', 'NOT_ALLOWED', 'staff: no report_daily');
select throws_ok($$ select * from public.report_orders_placed('2020-03-10', '2020-03-12') $$, '42501', 'NOT_ALLOWED', 'staff: no report_orders_placed');
select throws_ok($$ select * from public.report_top_products('2020-03-10', '2020-03-12') $$, '42501', 'NOT_ALLOWED', 'staff: no report_top_products');
select throws_ok($$ select * from public.report_drivers('2020-03-10', '2020-03-12') $$, '42501', 'NOT_ALLOWED', 'staff: no report_drivers');
select throws_ok($$ select * from public.report_waste('2020-03-10', '2020-03-12') $$, '42501', 'NOT_ALLOWED', 'staff: no report_waste');
select tests.as_user(tests.id('cust'));
select throws_ok($$ select public.report_summary('2020-03-10', '2020-03-12') $$, '42501', 'NOT_ALLOWED', 'customer: no reports');
select tests.as_user(tests.id('d1'));
select throws_ok($$ select * from public.report_top_products('2020-03-10', '2020-03-12') $$, '42501', 'NOT_ALLOWED', 'driver: no reports');
select tests.as_anon();
select throws_ok($$ select public.report_summary('2020-03-10', '2020-03-12') $$, '42501', null, 'anon: no execute grant');
select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('admin');
select tests.as_user(tests.id('admin'));
select throws_ok($$ select public.report_summary('2020-03-10', '2020-03-12') $$, '42501', 'NOT_ALLOWED',
  'admin with a temporary PIN: no reports until it is changed');
select tests.as_postgres();

-- ---------------------------------------------------------------- 10) L4(a): لا حذف فعلي لمنتج له تاريخ
select throws_ok(format($$ delete from public.products where id = %L $$, tests.id('p1')), '23503', null,
  'a product with orders and movements cannot be hard-deleted, even by postgres');
select tests.remember('p3', tests.new_product(1000, 5));
select throws_ok(format($$ delete from public.products where id = %L $$, tests.id('p3')), '23503', null,
  'a product with stock movements only (no orders) cannot be hard-deleted');
select tests.remember('p4', tests.new_product(1000, 0));
select is(tests.affected(format($$ delete from public.products where id = %L $$, tests.id('p4'))), 1,
  'a product with no history can still be deleted (stock row goes with it)');
select is(
  (select array_agg(conrelid::regclass::text || ':' || confdeltype::text order by conrelid::regclass::text)
     from pg_constraint where confrelid = 'public.products'::regclass and contype = 'f'
      and conrelid in ('public.order_items'::regclass, 'public.inventory_movements'::regclass)),
  array['inventory_movements:r', 'order_items:r'],
  'order_items and inventory_movements reference products ON DELETE RESTRICT');

select * from finish();
