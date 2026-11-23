#!/usr/bin/env node
// T20: سرعة دوال التقارير على حجم كبير (SPEC-admin §3: صفحة التقارير لمدى شهر < 1 ثانية).
//
//   node scripts/report-perf.mjs                    -> القاعدة المحلية (CI)، 200000 طلب
//   node scripts/report-perf.mjs --remote --orders=50000   -> mukhdar-dev فقط
//   ... --prelude=supabase/migrations/X.sql   -> migration غير مطبّقة تُنفَّذ داخل المعاملة أولاً (تُلغى)
//
// كل شيء داخل BEGIN ... ROLLBACK: يولّد سنة من البيانات (طلبات مسلّمة وملغاة ومعلّقة، 4 بنود لكل طلب
// بكلفتها، حركات هدر وجرد، سائقون)، يعيد بناء daily_stats ويحدّث الإحصاءات، ثم يقيس كل دالة تقارير
// بدور أدمن (EXPLAIN ANALYZE: وقت التنفيذ بالخادم، بلا زمن الشبكة). لا يبقى شيء بقاعدة البيانات.
// مراجعة C (L5): يغطي أيضاً الرئيسية (dashboard_today) والتقييمات (ratings_summary كل المدة وشهر، وratings_list
// الصفحة الأولى والعاشرة) بحدود 300/300/100ms، وتعليقات صفحة التقارير (ratings_list) تدخل مجموع الصفحة.
// الحدود: كل دالة لمدى شهر < 500ms، ومجموع ما تطلبه الصفحة لشهر < 1000ms (القبول)، وكل دالة لسنة < 2000ms.
//   --explain يطبع خطة استعلام أكثر المنتجات مبيعاً (تشخيص).
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeTarget, connect, describe, resolveTarget, root } from './lib/db.mjs';

const args = process.argv.slice(2);
const target = resolveTarget(args);
const ordersArg = args.find((a) => a.startsWith('--orders='));
const ORDERS = ordersArg ? Number(ordersArg.slice('--orders='.length)) : 200_000;
const preludeArg = args.find((a) => a.startsWith('--prelude='));
const prelude = preludeArg
  ? fs.readFileSync(path.resolve(root, preludeArg.slice('--prelude='.length)), 'utf8')
  : null;
// الحد الحقيقي (SPEC-admin T20): الصفحة لشهر < 1 ثانية. حد الدالة الواحدة حارس إضافي.
const MONTH_MS = 500;
const PAGE_MS = 1000;
const YEAR_MS = 2000;
const HOME_MS = 300;
const RATINGS_SUMMARY_MS = 300;
const RATINGS_PAGE_MS = 100;

try {
  assertSafeTarget(target);
} catch (err) {
  console.error(`Refusing: report-perf. ${err.message}`);
  process.exit(1);
}
if (!Number.isInteger(ORDERS) || ORDERS < 1000 || ORDERS > 2_000_000) {
  console.error('--orders must be an integer between 1000 and 2000000');
  process.exit(1);
}

const client = await connect(target);
console.log(`target: ${describe(target)}; ${ORDERS} orders over 366 days (rolled back)\n`);

const q = (sql, params) => client.query(sql, params);
let failures = 0;
let generationFailed = false;

// مرحلة التوليد (قبل القياس) عادةً 25-50 ثانية. مرة واحدة (2026-11-23، main) علقت 15 دقيقة حتى statement_timeout
// بلا أي سطر يدل على أي استعلام، فصار كل استعلام توليد يُسمّى ويُقيَّد بـ GEN_STATEMENT_MS (ثم يُبلَّغ باسمه)
// بدل أن يضيع الوقت كله بصمت. حدود القياس نفسها (500/1000/2000/300/100ms) لم تتغير.
const GEN_STATEMENT_MS = 180_000;
const gen = async (label, sql, params) => {
  const t = performance.now();
  try {
    const r = await q(sql, params);
    console.log(`  gen ${label.padEnd(24)} ${((performance.now() - t) / 1000).toFixed(1)}s`);
    return r;
  } catch (err) {
    err.message = `generation step "${label}" failed after ${((performance.now() - t) / 1000).toFixed(1)}s: ${err.message}`;
    err.isGeneration = true;
    throw err;
  }
};

try {
  await q('begin');
  await q(`set local statement_timeout = ${GEN_STATEMENT_MS}`);
  if (prelude) await q(prelude);
  const t0 = performance.now();

  const cat = (
    await gen('category', 
      `insert into public.categories (name) values ('perf ' || gen_random_uuid()) returning id`,
    )
  ).rows[0].id;
  await gen('products', 
    `insert into public.products (category_id, name, unit, price_iqd)
     select $1, 'perf ' || g, case when g % 3 = 0 then 'باقة' else 'نص كيلو' end, 250 * (2 + g % 8)
       from generate_series(1, 60) g`,
    [cat],
  );
  await gen('perf_products temp', 
    `create temp table perf_products on commit drop as
     select id, unit, price_iqd from public.products where category_id = $1`,
    [cat],
  );
  await gen('product_costs', `insert into public.product_costs (product_id, cost_iqd)
           select id, price_iqd - 250 from perf_products`);
  await q(`analyze perf_products`); // جداول temp لا يحللها autovacuum: بلا هذا يخمّن المخطط أحجامها
  await gen('perf_drivers temp', `create temp table perf_drivers on commit drop as
    select gen_random_uuid() as id, g from generate_series(1, 12) g`);
  await gen('driver users', `insert into auth.users (id, phone, aud, role)
           select id, (9647799990000 + g)::text, 'authenticated', 'authenticated' from perf_drivers`);
  await gen('driver profiles', `update public.profiles p set role = 'driver', full_name = 'سائق ' || d.g
             from perf_drivers d where p.id = d.id`);

  // الطلبات: 85% مسلّمة، 8% ملغاة، والباقي معلّقة؛ موزعة على 366 يوماً تنتهي أمس (بغداد)
  await gen('perf_orders temp', 
    `create temp table perf_orders on commit drop as
     select gen_random_uuid() as id, g,
            (public.baghdad_today() - 366)::timestamp at time zone 'Asia/Baghdad'
              + random() * interval '366 days' as created_at,
            case when g % 100 < 85 then 'delivered' when g % 100 < 93 then 'cancelled' else 'pending' end
              ::public.order_status as status
       from generate_series(1, $1::int) g`,
    [ORDERS],
  );
  await q(`analyze perf_orders, perf_drivers`);
  await gen('orders', `insert into public.orders (id, address_snapshot, status, subtotal_iqd, delivery_fee_iqd, total_iqd,
                                      idempotency_key, created_at, delivered_at, cancelled_at, driver_id)
           select o.id, '{}'::jsonb, o.status, 250 * (8 + o.g % 40), 1000, 250 * (8 + o.g % 40) + 1000,
                  gen_random_uuid(), o.created_at,
                  case when o.status = 'delivered' then o.created_at + interval '45 minutes' end,
                  case when o.status = 'cancelled' then o.created_at + interval '20 minutes' end,
                  case when o.status = 'delivered' then (select id from perf_drivers where g = 1 + o.g % 12) end
             from perf_orders o`);
  await gen('order_items', `with pp as (select id, unit, price_iqd, row_number() over (order by id) as n from perf_products)
           insert into public.order_items (order_id, product_id, name_snapshot, unit_snapshot,
                                           price_snapshot_iqd, qty, line_total_iqd)
           select o.id, pp.id, 'perf', pp.unit, pp.price_iqd, 1 + (o.g + k) % 5, pp.price_iqd * (1 + (o.g + k) % 5)
             from perf_orders o cross join generate_series(1, 4) k
             join pp on pp.n = 1 + (o.g * 7 + k * 13) % 60`);
  await q(`analyze public.order_items`);
  await gen('order_item_costs', `insert into public.order_item_costs (order_item_id, cost_snapshot_iqd)
           select i.id, i.price_snapshot_iqd - 250 from public.order_items i
             join perf_orders o on o.id = i.order_id`);
  // هدر وتسويات سالبة (~ 8 لكل يوم لكل … مجموعها ORDERS/5)
  await gen('inventory_movements', 
    `insert into public.inventory_movements (product_id, qty, type, note, unit_cost_iqd, created_at)
     select p.id, -(1 + g % 4), case when g % 4 = 0 then 'adjust' else 'waste' end::public.movement_type,
            'perf', p.price_iqd - 250,
            (public.baghdad_today() - 366)::timestamp at time zone 'Asia/Baghdad' + random() * interval '366 days'
       from generate_series(1, $1::int) g
       join (select id, price_iqd, row_number() over (order by id) as n from perf_products) p on p.n = 1 + g % 60`,
    [Math.floor(ORDERS / 5)],
  );
  // تقييمات لـ 60% من المسلّمة (دون زبون: customer_id اختياري، والتعليق لثلثها)
  await gen('ratings', `insert into public.ratings (order_id, stars, comment, created_at)
           select o.id, 1 + (o.g * 7) % 5, case when o.g % 3 = 0 then 'تعليق ' || o.g end,
                  o.created_at + interval '45 minutes' + random() * interval '2 hours'
             from perf_orders o where o.status = 'delivered' and o.g % 10 < 6`);
  await gen('rebuild_daily_stats', 
    `select private.rebuild_daily_stats(public.baghdad_today() - 367, public.baghdad_today())`,
  );
  await gen('analyze', `analyze public.orders, public.order_items, public.order_item_costs, public.inventory_movements,
           public.daily_stats, public.ratings, public.profiles`);
  const counts = (
    await q(`select (select count(*) from public.orders)::int as orders,
                    (select count(*) from public.order_items)::int as items,
                    (select count(*) from public.inventory_movements)::int as movements`)
  ).rows[0];
  console.log(
    `generated in ${((performance.now() - t0) / 1000).toFixed(1)}s: ${counts.orders} orders, ` +
      `${counts.items} items, ${counts.movements} movements in the database\n`,
  );

  if (args.includes('--explain')) {
    // تشخيص: خطة استعلام أكثر المنتجات مبيعاً لشهر بدور postgres (كما تعمل الدالة SECURITY DEFINER، بلا RLS)
    const plan = await q(
      `explain (analyze, buffers) select i.product_id, i.unit_snapshot, sum(i.qty), sum(i.line_total_iqd),
              coalesce(sum(c.cost_snapshot_iqd * i.qty), 0)
         from public.orders o
         join public.order_items i on i.order_id = o.id
         left join public.order_item_costs c on c.order_item_id = i.id
        where o.status = 'delivered'
          and o.delivered_at >= (public.baghdad_today() - 30)::timestamp at time zone 'Asia/Baghdad'
          and o.delivered_at < (public.baghdad_today() + 1)::timestamp at time zone 'Asia/Baghdad'
        group by 1, 2`,
    );
    console.log(plan.rows.map((r) => r['QUERY PLAN']).join(String.fromCharCode(10)));
  }

  // أدمن داخل المعاملة، والقياس بدوره (authenticated + JWT)
  const admin = (
    await q(`insert into auth.users (id, phone, aud, role)
             values (gen_random_uuid(), '9647799989999', 'authenticated', 'authenticated') returning id`)
  ).rows[0].id;
  await q(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  await q(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: admin, role: 'authenticated', aal: 'aal2' }), // T23 C1
  ]);
  await q(`set local role authenticated`);

  const calls = [
    ['report_summary', 'select public.report_summary($1, $2)'],
    ['report_daily', 'select * from public.report_daily($1, $2)'],
    ['report_top_products', 'select * from public.report_top_products($1, $2, 20)'],
    ['report_drivers', 'select * from public.report_drivers($1, $2)'],
    ['report_waste', 'select * from public.report_waste($1, $2)'],
    ['report_orders_placed', 'select * from public.report_orders_placed($1, $2)'],
  ];
  // تعليقات صفحة التقارير: نفس نداء الواجهة (آخر 20 تعليقاً بالمدى)
  const pageExtra = [
    [
      'ratings_list (report comments)',
      'select * from public.ratings_list($1, $2, 1, 5, true, null, null, 20)',
    ],
  ];
  const today = (await q(`select public.baghdad_today()::text as d`)).rows[0].d;
  const minus = (days) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const ranges = [
    ['month', minus(30), today, MONTH_MS],
    ['year', minus(365), today, YEAR_MS],
  ];

  for (const [label, from, to, limit] of ranges) {
    let pageTotal = 0;
    console.log(`${label} (${from} .. ${to}):`);
    for (const [name, sql] of calls) {
      await q(sql, [from, to]); // تسخين الذاكرة
      const plan = (await q(`explain (analyze, format json) ${sql}`, [from, to])).rows[0][
        'QUERY PLAN'
      ];
      const ms = plan[0]['Execution Time'];
      if (name !== 'report_orders_placed') pageTotal += ms; // الصفحة لا تطلبها منفصلة (داخل report_daily)
      const ok = ms < limit;
      if (!ok) failures++;
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(22)} ${ms.toFixed(1).padStart(8)} ms (limit ${limit})`,
      );
    }
    if (label === 'month') {
      for (const [name, sql] of pageExtra) {
        await q(sql, [from, to]);
        const plan = (await q(`explain (analyze, format json) ${sql}`, [from, to])).rows[0][
          'QUERY PLAN'
        ];
        const ms = plan[0]['Execution Time'];
        pageTotal += ms;
        const ok = ms < RATINGS_PAGE_MS;
        if (!ok) failures++;
        console.log(
          `  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(22)} ${ms.toFixed(1).padStart(8)} ms (limit ${RATINGS_PAGE_MS})`,
        );
      }
      const ok = pageTotal < PAGE_MS;
      if (!ok) failures++;
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${'page (all calls)'.padEnd(22)} ${pageTotal.toFixed(1).padStart(8)} ms (limit ${PAGE_MS})`,
      );
    }
  }

  // الرئيسية والتقييمات (L5): من الأدمن نفسه
  const timed = async (name, sql, params, limit) => {
    await q(sql, params);
    const plan = (await q(`explain (analyze, format json) ${sql}`, params)).rows[0]['QUERY PLAN'];
    const ms = plan[0]['Execution Time'];
    const ok = ms < limit;
    if (!ok) failures++;
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(22)} ${ms.toFixed(1).padStart(8)} ms (limit ${limit})`,
    );
  };
  console.log('home and ratings:');
  await timed('dashboard_today', 'select public.dashboard_today()', [], HOME_MS);
  await timed('ratings_summary all', 'select public.ratings_summary()', [], RATINGS_SUMMARY_MS);
  await timed(
    'ratings_summary month',
    'select public.ratings_summary($1, $2)',
    [minus(30), today],
    RATINGS_SUMMARY_MS,
  );
  await timed('ratings_list page 1', 'select * from public.ratings_list()', [], RATINGS_PAGE_MS);
  // الصفحة العاشرة: نمشي 9 صفحات بالمؤشر (صفحات 50) ثم نقيس العاشرة
  let c = null;
  let o = null;
  for (let i = 0; i < 9; i++) {
    const row = (
      await q(
        `select created_at::text as c, order_id::text as o from public.ratings_list(null, null, 1, 5, false, $1::timestamptz, $2::uuid, 50) offset 49 limit 1`,
        [c, o],
      )
    ).rows[0];
    if (!row) break;
    c = row.c;
    o = row.o;
  }
  await timed(
    'ratings_list page 10',
    'select * from public.ratings_list(null, null, 1, 5, false, $1::timestamptz, $2::uuid, 50)',
    [c, o],
    RATINGS_PAGE_MS,
  );
} catch (err) {
  console.error(`error: ${err.message}`);
  failures++;
  if (err.isGeneration) generationFailed = true;
} finally {
  await q('rollback');
  await client.end();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall report timings within limits');
process.exit(failures ? 1 : 0);
