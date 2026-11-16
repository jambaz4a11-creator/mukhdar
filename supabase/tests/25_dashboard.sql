-- 25: الرئيسية (T25). dashboard_today() بوقت ثابت عبر private.dashboard_at (2020-03-11 12:30:20 بغداد)،
--   وبأرقام محسوبة يدوياً على حدود يوم بغداد ونافذة "أمس حتى نفس الدقيقة":
--     اليوم 03-11: [03-10 21:00Z, 03-11 09:31Z) (نهاية الدقيقة الحالية)، أمس 03-10: [03-09 21:00Z, 03-10 09:31Z).
--   المال للأدمن فقط ومحذوف بالدالة للموظف (مفاتيحه موجودة بقيمة null)؛ الزبون والسائق والزائر والمعطّل
--   والأدمن برمز مؤقت يُرفضون. الأيام 2020-03-09..13 خالية من بيانات أخرى.
select plan(28);

-- ================================================================ التجهيز
update public.app_settings set delivery_fee_iqd = 1000, min_order_iqd = 0, store_open = true;
-- منتجات الاختبار فقط تُحسب بالنقص: غيرها (seed إن وُجد) يُعطَّل داخل المعاملة
update public.products set is_active = false;

select tests.remember('admin',  tests.new_user('admin'));
select tests.remember('admin2', tests.new_user('admin'));
select tests.remember('staff',  tests.new_user('staff'));
select tests.remember('staff2', tests.new_user('staff'));
select tests.remember('cust',   tests.new_user('customer'));
select tests.remember('drv',    tests.new_user('driver'));
select tests.remember('p', tests.new_product(1500, 1000, true, 1000));
-- المخزون: pl رصيد 3 من حد 5 (قليل)، pz رصيد 0 من حد 5 (نفد)، pi معطّل، pok رصيد 10 (عادي)
select tests.remember('pl',  tests.new_product(1000, 3, true, 500));
select tests.remember('pz',  tests.new_product(1000, 0, true, 500));
select tests.remember('pi',  tests.new_product(1000, 1, false, 500));
select tests.remember('pok', tests.new_product(1000, 10, true, 500));
update public.products set name = 'قليل T25', unit = 'باقة' where id = tests.id('pl');
update public.products set name = 'نافد T25' where id = tests.id('pz');
update public.products set name = 'معطّل T25' where id = tests.id('pi');
update public.products set name = 'عادي T25' where id = tests.id('pok');

-- لقطة قبل أي طلب: المفتوحة الآن حالة حالية (بلا يوم)، فنقيسها بفرق عن هذه اللقطة
create table tests.base as select private.dashboard_at('2020-03-11 09:30:20Z', true) as j;

-- طلب بكمية p_qty من المنتج p يُقاد للحالة النهائية (كأدمن، بسائق إن تجاوز pending)
create function tests.mk(p_qty int, p_final public.order_status) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p'), p_qty)));
  perform tests.set_uid(tests.id('admin'));
  if p_final = 'cancelled' then
    perform public.set_order_status(v, 'cancelled', 'T25');
  elsif p_final <> 'pending' then
    perform public.set_order_status(v, 'preparing');
    perform public.assign_driver(v, tests.id('drv'));
    if p_final <> 'preparing' then
      perform public.set_order_status(v, 'ready');
      if p_final in ('out_for_delivery', 'delivered') then
        perform public.set_order_status(v, 'out_for_delivery');
      end if;
      if p_final = 'delivered' then perform public.set_order_status(v, 'delivered'); end if;
    end if;
  end if;
  perform set_config('request.jwt.claims', '{}', true);
  return v;
end $$;

-- اليوم 03-11 (بغداد)
select tests.remember('a0', tests.mk(1, 'delivered'));   -- 1500، سُلّم 00:00:30 بغداد (اليوم)، أُنشئ أمس 23:00
select tests.remember('a1', tests.mk(2, 'delivered'));   -- 3000
select tests.remember('a2', tests.mk(3, 'delivered'));   -- 4500، سُلّم 12:30:10 (داخل الدقيقة الحالية)
select tests.remember('a3', tests.mk(1, 'delivered'));   -- 1500، سُلّم 12:31:30 (بعد الآن ← خارج المقارنة)
select tests.remember('a4', tests.mk(1, 'cancelled'));
select tests.remember('o_pend', tests.mk(1, 'pending'));
select tests.remember('o_late', tests.mk(1, 'pending')); -- أُنشئ 12:45 (بعد الآن)
select tests.remember('o_prep', tests.mk(1, 'preparing')); -- أُنشئ أمس 20:00 ولا يزال مفتوحاً
select tests.remember('o_rdy',  tests.mk(1, 'ready'));
select tests.remember('o_out',  tests.mk(1, 'out_for_delivery'));
-- أمس 03-10
select tests.remember('b0', tests.mk(1, 'delivered'));   -- سُلّم 03-09 23:59 (قبل أمس)
select tests.remember('b1', tests.mk(4, 'delivered'));   -- 6000، سُلّم 12:30 (داخل النافذة)
select tests.remember('b2', tests.mk(1, 'delivered'));   -- 1500، سُلّم 12:31:30 (بعد النافذة)
select tests.remember('b3', tests.mk(2, 'delivered'));   -- 3000، سُلّم 23:59 (آخر دقيقة بيوم أمس)
select tests.remember('b4', tests.mk(1, 'cancelled'));   -- أُلغي 10:00 (داخل النافذة)
select tests.remember('b6', tests.mk(1, 'cancelled'));   -- أُلغي 13:00 (بعد النافذة)

-- هدر ونقص (بكلفة p الحالية 1000): أمس هدر 2 (2000)، اليوم هدر 1 (1000) ونقص 2 (2000)
select tests.set_uid(tests.id('admin'));
select public.adjust_stock(tests.id('p'), -2, 'waste', 'هدر أمس T25');
select public.adjust_stock(tests.id('p'), -1, 'waste', 'هدر اليوم T25');
select public.adjust_stock(tests.id('p'), -2, 'adjust', 'نقص اليوم T25');
select tests.as_postgres();

-- نقل الأوقات (الأوقات UTC؛ بغداد = +3)
update public.orders set created_at = '2020-03-10 20:00Z', delivered_at = '2020-03-10 21:00:30Z' where id = tests.id('a0');
update public.orders set created_at = '2020-03-11 06:30Z', delivered_at = '2020-03-11 07:00Z'    where id = tests.id('a1');
update public.orders set created_at = '2020-03-11 08:00Z', delivered_at = '2020-03-11 09:30:10Z' where id = tests.id('a2');
update public.orders set created_at = '2020-03-11 08:30Z', delivered_at = '2020-03-11 09:31:30Z' where id = tests.id('a3');
update public.orders set created_at = '2020-03-11 05:00Z', cancelled_at = '2020-03-11 06:00Z'    where id = tests.id('a4');
update public.orders set created_at = '2020-03-11 08:50Z' where id = tests.id('o_pend');
update public.orders set created_at = '2020-03-11 09:45Z' where id = tests.id('o_late');
update public.orders set created_at = '2020-03-10 17:00Z' where id = tests.id('o_prep');
update public.orders set created_at = '2020-03-11 07:30Z' where id = tests.id('o_rdy');
update public.orders set created_at = '2020-03-11 07:45Z' where id = tests.id('o_out');
update public.orders set created_at = '2020-03-09 17:00Z', delivered_at = '2020-03-09 20:59Z'    where id = tests.id('b0');
update public.orders set created_at = '2020-03-10 05:00Z', delivered_at = '2020-03-10 09:30Z'    where id = tests.id('b1');
update public.orders set created_at = '2020-03-10 05:30Z', delivered_at = '2020-03-10 09:31:30Z' where id = tests.id('b2');
update public.orders set created_at = '2020-03-10 06:00Z', delivered_at = '2020-03-10 20:59Z'    where id = tests.id('b3');
update public.orders set created_at = '2020-03-10 06:30Z', cancelled_at = '2020-03-10 07:00Z'    where id = tests.id('b4');
update public.orders set created_at = '2020-03-10 07:00Z', cancelled_at = '2020-03-10 10:00Z'    where id = tests.id('b6');
update public.inventory_movements set created_at = '2020-03-10 05:00Z' where note = 'هدر أمس T25';
update public.inventory_movements set created_at = '2020-03-11 08:00Z' where note = 'هدر اليوم T25';
update public.inventory_movements set created_at = '2020-03-11 07:00Z' where note = 'نقص اليوم T25';
select private.rebuild_daily_stats('2020-03-08', '2020-03-14');
select private.rebuild_daily_stats(public.baghdad_today(), public.baghdad_today());

-- ================================================================ 1) الشكل (مفاتيح ثابتة)
select is(
  (select array_agg(k order by k) from jsonb_object_keys(private.dashboard_at('2020-03-11 09:30:20Z', false)) k),
  array['as_of', 'avg_order_iqd', 'avg_order_prev_iqd', 'cancelled_count', 'cancelled_count_prev',
        'day', 'delivered_count', 'delivered_count_prev', 'low_stock_count', 'low_stock_items',
        'net_profit_iqd', 'net_profit_prev_iqd', 'open', 'placed_count', 'placed_count_prev',
        'sales_iqd', 'sales_prev_iqd', 'waste_cost_iqd'],
  'fixed key set (staff has the same keys, money values null)');

-- ================================================================ 2) اليوم حتى الآن (الأدمن، 12:30:20 بغداد)
select is(
  (select jsonb_build_object(
            'day', j -> 'day', 'delivered', j -> 'delivered_count', 'cancelled', j -> 'cancelled_count',
            'placed', j -> 'placed_count', 'sales', j -> 'sales_iqd', 'avg', j -> 'avg_order_iqd')
     from (select private.dashboard_at('2020-03-11 09:30:20Z', true) j) x),
  '{"day": "2020-03-11", "delivered": 3, "cancelled": 1, "placed": 7, "sales": 9000, "avg": 3000}'::jsonb,
  'today so far: delivered a0 (00:00:30 counts today) + a1 + a2 (12:30:10); a3 (12:31:30) is after now; sales exclude the fee');

-- ================================================================ 3) أمس حتى نفس الدقيقة (لا أمس كاملاً)
select is(
  (select jsonb_build_object(
            'delivered', j -> 'delivered_count_prev', 'cancelled', j -> 'cancelled_count_prev',
            'placed', j -> 'placed_count_prev', 'sales', j -> 'sales_prev_iqd', 'avg', j -> 'avg_order_prev_iqd')
     from (select private.dashboard_at('2020-03-11 09:30:20Z', true) j) x),
  '{"delivered": 1, "cancelled": 1, "placed": 5, "sales": 6000, "avg": 6000}'::jsonb,
  'yesterday to the same minute: only b1 (12:30); b2 (12:31:30), b3 (23:59), b0 (day before) excluded; not the whole day');

-- ================================================================ 4) حدود اليوم
select is(
  (select jsonb_build_object('delivered', j -> 'delivered_count', 'sales', j -> 'sales_iqd',
                             'rev', (select revenue_iqd from public.daily_stats where day = '2020-03-10'))
     from (select private.dashboard_at('2020-03-10 20:59:30Z', true) j) x),
  '{"delivered": 3, "sales": 10500, "rev": 10500}'::jsonb,
  'an order delivered at 23:59 Baghdad counts for that day (b1+b2+b3) and equals daily_stats revenue');
select is(
  (select jsonb_build_object('day', j -> 'day', 'delivered', j -> 'delivered_count', 'delivered_prev', j -> 'delivered_count_prev')
     from (select private.dashboard_at('2020-03-10 21:00:40Z', true) j) x),
  '{"day": "2020-03-11", "delivered": 1, "delivered_prev": 0}'::jsonb,
  'a0 delivered 00:00:30 counts for the new day (03-11), not the previous one');
select is(
  (select j -> 'delivered_count_prev' from (select private.dashboard_at('2020-03-11 20:59:30Z', true) j) x), '3'::jsonb,
  'yesterday at 23:59:30 (whole of 03-10): b1+b2+b3 = 3 (a0 delivered 00:00:30 belongs to 03-11, not 03-10)');

-- ================================================================ 5) المفتوحة الآن وتحت حد النقص
select is(
  (select jsonb_build_object(
            'pending', (a.j -> 'open' ->> 'pending')::int - (b.j -> 'open' ->> 'pending')::int,
            'preparing', (a.j -> 'open' ->> 'preparing')::int - (b.j -> 'open' ->> 'preparing')::int,
            'ready', (a.j -> 'open' ->> 'ready')::int - (b.j -> 'open' ->> 'ready')::int,
            'out', (a.j -> 'open' ->> 'out_for_delivery')::int - (b.j -> 'open' ->> 'out_for_delivery')::int)
     from (select private.dashboard_at('2020-03-11 09:30:20Z', true) j) a, tests.base b),
  '{"pending": 2, "preparing": 1, "ready": 1, "out": 1}'::jsonb,
  'open orders by current status, any creation day (o_pend + o_late, o_prep, o_rdy, o_out); delivered/cancelled excluded');
select is(
  (select jsonb_build_object('n', j -> 'low_stock_count', 'items', j -> 'low_stock_items')
     from (select private.dashboard_at('2020-03-11 09:30:20Z', false) j) x),
  jsonb_build_object('n', 2, 'items', jsonb_build_array(
    jsonb_build_object('product_id', tests.id('pz'), 'name', 'نافد T25', 'unit', 'نص كيلو', 'qty', 0, 'threshold', 5),
    jsonb_build_object('product_id', tests.id('pl'), 'name', 'قليل T25', 'unit', 'باقة', 'qty', 3, 'threshold', 5))),
  'below threshold: active only, qty < threshold, sorted by qty (out of stock first); inactive and normal stock excluded');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     private.dashboard_at('2020-03-11 09:30:20Z', false) -> 'low_stock_items' -> 0) k),
  array['name', 'product_id', 'qty', 'threshold', 'unit'], 'low stock item keys are quantity-only');

-- ================================================================ 6) المال من daily_stats (أدمن)
-- اليوم 03-11: إيراد 10500 (a0+a1+a2+a3)، كلفة 7000، إجمالي 3500، هدر 1000، نقص 2000 ← صافي 500
-- أمس 03-10 كاملاً: إيراد 10500 (b1+b2+b3)، كلفة 7000، إجمالي 3500، هدر 2000 ← صافي 1500
select is(
  (select jsonb_build_object('waste', j -> 'waste_cost_iqd', 'net', j -> 'net_profit_iqd', 'net_prev', j -> 'net_profit_prev_iqd')
     from (select private.dashboard_at('2020-03-11 09:30:20Z', true) j) x),
  '{"waste": 1000, "net": 500, "net_prev": 1500}'::jsonb,
  'net profit today and the whole of yesterday = gross - waste - shortage; waste cost = waste only');
select is(
  (select j -> 'net_profit_iqd' from (select private.dashboard_at('2020-03-11 09:30:20Z', true) j) x),
  (select to_jsonb(net_profit_iqd) from public.daily_stats where day = '2020-03-11'),
  'net profit today equals the daily_stats row');
select is(
  (select jsonb_build_object('sales', j -> 'sales_iqd', 'net_prev', j -> 'net_profit_prev_iqd', 'avg', j -> 'avg_order_iqd',
                             'dp', j -> 'delivered_count_prev', 'waste', j -> 'waste_cost_iqd')
     from (select private.dashboard_at('2020-03-13 09:30:00Z', true) j) x),
  '{"sales": 0, "net_prev": null, "avg": null, "dp": 0, "waste": 0}'::jsonb,
  'a day with no data: zeros, average null, no yesterday row => net_profit_prev null ("—", not 0)');

-- ================================================================ 7) الواجهة العامة بأدوارها (الآن الحقيقي)
-- نتيجة كل دور تُحفظ بإعداد GUC للمعاملة (لا جدول: authenticated لا ينشئ جداولاً)
select tests.as_user(tests.id('admin'));
select set_config('tests.admin_j', public.dashboard_today()::text, true);
select isnt(public.dashboard_today() -> 'sales_iqd', 'null'::jsonb, 'admin: sales present');
select isnt(public.dashboard_today() -> 'net_profit_iqd', 'null'::jsonb, 'admin: net profit present');
select tests.as_user(tests.id('staff'));
select set_config('tests.staff_j', public.dashboard_today()::text, true);
select tests.as_postgres();

select is(
  (select array_agg(k order by k) from jsonb_each(current_setting('tests.staff_j')::jsonb) e(k, v)
    where k in ('sales_iqd', 'sales_prev_iqd', 'avg_order_iqd', 'avg_order_prev_iqd', 'waste_cost_iqd',
                'net_profit_iqd', 'net_profit_prev_iqd') and jsonb_typeof(v) = 'null'),
  array['avg_order_iqd', 'avg_order_prev_iqd', 'net_profit_iqd', 'net_profit_prev_iqd', 'sales_iqd',
        'sales_prev_iqd', 'waste_cost_iqd'],
  'staff: every money field is null (present, but removed by the function)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(current_setting('tests.staff_j')::jsonb) k),
  (select array_agg(k order by k) from jsonb_object_keys(current_setting('tests.admin_j')::jsonb) k),
  'staff and admin get the same keys');
select is(
  current_setting('tests.admin_j')::jsonb - 'sales_iqd' - 'sales_prev_iqd' - 'avg_order_iqd' - 'avg_order_prev_iqd'
    - 'waste_cost_iqd' - 'net_profit_iqd' - 'net_profit_prev_iqd',
  current_setting('tests.staff_j')::jsonb - 'sales_iqd' - 'sales_prev_iqd' - 'avg_order_iqd' - 'avg_order_prev_iqd'
    - 'waste_cost_iqd' - 'net_profit_iqd' - 'net_profit_prev_iqd',
  'staff gets exactly the admin counts and lists (same moment); only money differs');
select is(
  (current_setting('tests.staff_j')::jsonb -> 'open' ->> 'pending')::int - (select (j -> 'open' ->> 'pending')::int from tests.base),
  2, 'staff sees the open-order counts (not money)');

-- ================================================================ 8) الرفض
select tests.as_user(tests.id('cust'));
select throws_ok($$ select public.dashboard_today() $$, '42501', 'NOT_ALLOWED', 'customer denied');
select tests.as_user(tests.id('drv'));
select throws_ok($$ select public.dashboard_today() $$, '42501', 'NOT_ALLOWED', 'driver denied');
select tests.as_anon();
select throws_ok($$ select public.dashboard_today() $$, '42501', null, 'anon: no execute grant');
select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('admin2');
select tests.as_user(tests.id('admin2'));
select throws_ok($$ select public.dashboard_today() $$, '42501', 'NOT_ALLOWED',
  'admin with a temporary PIN (flagged): denied until the PIN is changed');
select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('staff2');
select tests.as_user(tests.id('staff2'));
select throws_ok($$ select public.dashboard_today() $$, '42501', 'NOT_ALLOWED', 'staff with a temporary PIN: denied');
select tests.as_postgres();
update public.profiles set must_change_pin = false, is_active = false where id = tests.id('staff2');
select tests.as_user(tests.id('staff2'));
select throws_ok($$ select public.dashboard_today() $$, '42501', 'NOT_ALLOWED', 'deactivated staff: denied');
select tests.as_postgres();

-- ================================================================ 9) الصلاحيات والفهارس
select is(has_function_privilege('authenticated', 'private.dashboard_at(timestamptz, boolean)', 'execute'), false,
  'authenticated cannot call the internal fixed-time function (it would let anyone ask for money)');
select is(has_function_privilege('anon', 'public.dashboard_today()', 'execute'), false, 'anon has no execute on dashboard_today');
select is(has_function_privilege('authenticated', 'public.dashboard_today()', 'execute'), true,
  'authenticated may call dashboard_today (role checked inside)');
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'orders'
      and indexname in ('orders_cancelled_at_idx', 'orders_delivered_at_idx')
      and indexdef like '%WHERE (status = ''%'),
  2, 'partial indexes: cancelled_at where status = cancelled, delivered_at where status = delivered');

select * from finish();
