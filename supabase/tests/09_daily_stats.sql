-- 09: daily_stats يطابق الطلبات الفعلية (قبول T05)
-- لكل يوم بتوقيت بغداد: عدد المسلّم والملغى، الإيراد، الأجرة، التكلفة، الربح الإجمالي.
-- يعمل على أي بيانات موجودة (فارغة، أو بعد seed:demo)، ثم بعد إضافة طلبات جديدة.
-- نفس المنطق بـ scripts/lib/demo.mjs (STATS_MISMATCH_SQL).
select plan(4);

create function tests.stats_mismatches() returns setof text language sql as $$
  with order_costs as (
    select i.order_id, sum(c.cost_snapshot_iqd * i.qty)::bigint as cost
      from public.order_items i join public.order_item_costs c on c.order_item_id = i.id
     group by i.order_id
  ), delivered as (
    select (o.delivered_at at time zone 'Asia/Baghdad')::date as day, count(*)::int as n,
           sum(o.subtotal_iqd)::bigint as revenue, sum(o.delivery_fee_iqd)::bigint as fees,
           coalesce(sum(oc.cost), 0)::bigint as cost
      from public.orders o left join order_costs oc on oc.order_id = o.id
     where o.status = 'delivered' group by 1
  ), cancelled as (
    select (cancelled_at at time zone 'Asia/Baghdad')::date as day, count(*)::int as n
      from public.orders where status = 'cancelled' group by 1
  ), expected as (
    select coalesce(d.day, c.day) as day, coalesce(d.n, 0) as delivered_count, coalesce(c.n, 0) as cancelled_count,
           coalesce(d.revenue, 0) as revenue_iqd, coalesce(d.fees, 0) as delivery_fees_iqd,
           coalesce(d.cost, 0) as cost_iqd, coalesce(d.revenue, 0) - coalesce(d.cost, 0) as gross_profit_iqd
      from delivered d full join cancelled c on c.day = d.day
  ), actual as (
    select day, delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd
      from public.daily_stats
     where (delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd)
           <> (0, 0, 0, 0, 0, 0)
  )
  select coalesce(e.day, a.day)::text || ': expected ' || coalesce((to_jsonb(e) - 'day')::text, 'nothing')
         || ', got ' || coalesce((to_jsonb(a) - 'day')::text, 'nothing')
    from expected e full join actual a on a.day = e.day
   where (to_jsonb(e) - 'day') is distinct from (to_jsonb(a) - 'day')
$$;

select is_empty($$ select * from tests.stats_mismatches() $$, 'daily_stats matches existing orders for every day');
select is((select count(*)::int from public.daily_stats
            where least(delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd) < 0), 0,
  'no negative daily_stats values');

-- بعد تسليم طلب وإلغاء آخر عبر الدوال، يبقى التطابق
select tests.remember('cust', tests.new_user('customer'));
select tests.remember('admin', tests.new_user('admin'));
select tests.remember('p', tests.new_product(3000, 10, true, 1750));
select tests.remember('o1', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p'), 2))));
select tests.remember('o2', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p'), 1))));
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o1'), 'preparing');
select public.assign_driver(tests.id('o1'), tests.new_user('driver'));
select public.set_order_status(tests.id('o1'), 'ready');
select public.set_order_status(tests.id('o1'), 'out_for_delivery');
select public.set_order_status(tests.id('o1'), 'delivered');
select public.set_order_status(tests.id('o2'), 'preparing');
select public.set_order_status(tests.id('o2'), 'ready');
select public.set_order_status(tests.id('o2'), 'cancelled');

select is_empty($$ select * from tests.stats_mismatches() $$, 'still matches after a delivery and a cancellation');
select is((select gross_profit_iqd = revenue_iqd - cost_iqd from public.daily_stats where day = public.baghdad_today()),
  true, 'gross profit = revenue - cost');

select * from finish();
