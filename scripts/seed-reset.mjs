#!/usr/bin/env node
// يمسح بيانات العرض فقط (T05): مستخدمو العرض/الحمل (بادئة الهاتف 9647000 / 9647001) وكل ما يخصهم.
// للتطوير فقط: نفس حماية seed:demo.
//
//   pnpm seed:reset              -> المحلي
//   pnpm seed:reset -- --remote  -> mukhdar-dev
//
// لا يمس الكتالوج والعناوين من supabase/seed.sql ولا الصور.
// يعكس أثر العرض بدقة: يطرح مساهمة طلباته من daily_stats، ويعكس حركات المخزون التي أنشأها.
import { assertSafeTarget, connect, describe, resolveTarget } from './lib/db.mjs';
import { DEMO_PHONE_LIKE, STATS_MISMATCH_SQL } from './lib/demo.mjs';

const target = resolveTarget();
assertSafeTarget(target);

const RESET_SQL = [
  `create temp table demo_users on commit drop as
     select id from public.profiles
      where phone like any (array[${DEMO_PHONE_LIKE.map((p) => `'${p.replace(/[^0-9%]/g, '')}'`).join(', ')}])`,
  `create temp table demo_orders on commit drop as
     select id from public.orders where customer_id in (select id from demo_users)`,

  // daily_stats: نطرح مساهمة طلبات العرض (نفس منطق set_order_status) بيوم التسليم/الإلغاء ببغداد
  `with order_costs as (
     select i.order_id, sum(c.cost_snapshot_iqd * i.qty)::bigint as cost
       from public.order_items i join public.order_item_costs c on c.order_item_id = i.id
      where i.order_id in (select id from demo_orders) group by i.order_id
   ), contrib as (
     select (o.delivered_at at time zone 'Asia/Baghdad')::date as day, count(*)::int as delivered, 0 as cancelled,
            sum(o.subtotal_iqd)::bigint as revenue, sum(o.delivery_fee_iqd)::bigint as fees,
            coalesce(sum(oc.cost), 0)::bigint as cost
       from public.orders o left join order_costs oc on oc.order_id = o.id
      where o.id in (select id from demo_orders) and o.status = 'delivered' group by 1
     union all
     select (cancelled_at at time zone 'Asia/Baghdad')::date, 0, count(*)::int, 0, 0, 0
       from public.orders where id in (select id from demo_orders) and status = 'cancelled' group by 1
   ), per_day as (
     select day, sum(delivered)::int d, sum(cancelled)::int c, sum(revenue)::bigint r, sum(fees)::bigint f,
            sum(cost)::bigint k from contrib group by day
   )
   update public.daily_stats s set
          delivered_count = s.delivered_count - p.d, cancelled_count = s.cancelled_count - p.c,
          revenue_iqd = s.revenue_iqd - p.r, delivery_fees_iqd = s.delivery_fees_iqd - p.f,
          cost_iqd = s.cost_iqd - p.k, gross_profit_iqd = s.gross_profit_iqd - (p.r - p.k), updated_at = now()
     from per_day p where s.day = p.day`,
  `delete from public.daily_stats
    where (delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd)
          = (0, 0, 0, 0, 0, 0)`,

  // المخزون: نعكس صافي حركات العرض (بيع، إرجاع، شراء صباحي) ثم نحذفها من الدفتر
  `create temp table demo_moves on commit drop as
     select id, product_id, qty from public.inventory_movements
      where order_id in (select id from demo_orders) or created_by in (select id from demo_users)`,
  `update public.stock s set qty = greatest(0, s.qty - m.net), updated_at = now()
     from (select product_id, sum(qty)::int as net from demo_moves group by product_id) m
    where s.product_id = m.product_id`,
  `delete from public.inventory_movements where id in (select id from demo_moves)`,

  `delete from public.notification_outbox
    where user_id in (select id from demo_users) or data ->> 'order_id' in (select id::text from demo_orders)`,
  // البنود والتكاليف والتاريخ والتقييمات تُحذف تتابعياً مع الطلب
  `delete from public.orders where id in (select id from demo_orders)`,
  // الملفات الشخصية والعناوين ورموز الإشعارات والهويات تُحذف تتابعياً مع المستخدم
  `delete from auth.users where id in (select id from demo_users)`,
];

const client = await connect(target);
console.log(`seed:reset -> ${describe(target)}`);
try {
  await client.query('begin');
  const counts = {};
  for (const sql of RESET_SQL) {
    const res = await client.query(sql);
    if (sql.includes('delete from public.orders')) counts.orders = res.rowCount;
    if (sql.includes('delete from auth.users')) counts.users = res.rowCount;
    if (sql.includes('delete from public.inventory_movements')) counts.movements = res.rowCount;
  }
  const { rows: mismatches } = await client.query(STATS_MISMATCH_SQL);
  if (mismatches.length) {
    throw new Error(
      `daily_stats would not match orders after reset: ${JSON.stringify(mismatches.slice(0, 3))}`,
    );
  }
  await client.query('commit');
  console.log(
    `removed ${counts.users} users, ${counts.orders} orders, ${counts.movements} stock movements`,
  );
  console.log('check: daily_stats matches delivered/cancelled orders for every day');
} catch (err) {
  await client.query('rollback').catch(() => {});
  console.error(`seed:reset failed (nothing changed): ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
