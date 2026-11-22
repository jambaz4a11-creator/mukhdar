#!/usr/bin/env node
// يلغي طلبات العرض القديمة العالقة (تطوير فقط، 2026-11-22). مثال:
//   pnpm dev:cancel-stale-orders -- --remote            -> معاينة فقط (لا يغيّر شيئاً)
//   pnpm dev:cancel-stale-orders -- --remote --apply    -> تنفيذ
//   --hours=N  (افتراضي 24): أقدم من N ساعة
//
// السبب: طلبات seed:demo القديمة تبقى "جاهزة" لأيام بعناوين من قبل شجرة العناوين الدقيقة (مثلاً بلوك B7 بناية 89)
// فتملأ قائمة السائق. القواعد:
// - "طلب عرض" = زبونه حساب عرض أو حمل (رقمه يبدأ بـ 9647000 أو 9647001، scripts/lib/demo.mjs). أي طلب آخر
//   (حساب حقيقي/شخصي، أو زبون محذوف) **لا يُمس**، ويُعدّ فقط بالمعاينة.
// - غير المسلّم وغير الملغى فقط (pending/preparing/ready/out_for_delivery) وأقدم من 24 ساعة بـ created_at.
// - الإلغاء بالمسار الحقيقي: `public.set_order_status(id, 'cancelled', ...)` بدور authenticated وبهوية أدمن العرض
//   (aal2)، فيرجع المخزون (cancel_return) ويُكتب السجل وdaily_stats كأي إلغاء من اللوحة. لا كتابة مباشرة بالجداول.
// - إشعارات الإلغاء التي تولّدها الدالة تُحذف بنفس المعاملة (تنظيف، لا رسائل لأجهزة السواق/الزبائن التجريبيين).
// - معاملة واحدة: أي خطأ ← لا شيء يتغير. المعاينة تنفّذ نفس المسار ثم ROLLBACK.
// الحماية: نفس حرّاس seed:demo (assertSafeTarget: يرفض الإنتاج وأي مشروع غير mukhdar-dev؛ connectDev: علامة
// private.deployment = dev داخل القاعدة).
import { assertSafeTarget, connectDev, describe, resolveTarget } from './lib/db.mjs';
import { DEMO_PHONE_LIKE, DEMO_PHONE_PREFIX, phone } from './lib/demo.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const hoursArg = args.find((a) => a.startsWith('--hours='))?.slice('--hours='.length);
const hours = hoursArg === undefined ? 24 : Number(hoursArg);
if (!Number.isInteger(hours) || hours < 24) {
  // أقل من 24 ساعة قد يلغي طلب عرض يجرّبه أحد الآن
  console.error('usage: dev-cancel-stale-orders.mjs [--remote] [--hours=N (>= 24)] [--apply]');
  process.exit(2);
}

const target = resolveTarget(args);
assertSafeTarget(target);
const client = await connectDev(target);
const ADMIN_PHONE = phone(DEMO_PHONE_PREFIX, 1); // مدير العرض (seed:demo)
const REASON = 'تنظيف بيانات العرض القديمة';

console.log(
  `${apply ? 'APPLY' : 'DRY RUN'} on ${describe(target)}: demo orders older than ${hours}h, not delivered/cancelled`,
);
try {
  await client.query('begin');

  const admin = await client.query(
    `select id from public.profiles where phone = $1 and role = 'admin' and is_active and not must_change_pin`,
    [ADMIN_PHONE],
  );
  if (!admin.rows[0])
    throw new Error(`demo admin 0${ADMIN_PHONE.slice(3)} not found/active (run seed:demo)`);
  const adminId = admin.rows[0].id;

  const { rows: stale } = await client.query(
    `select o.id, o.order_number, o.status::text, o.created_at,
            o.address_snapshot ->> 'subsection' as block, o.address_snapshot ->> 'building' as building,
            (p.phone like any($2::text[])) as demo
       from public.orders o left join public.profiles p on p.id = o.customer_id
      where o.status in ('pending', 'preparing', 'ready', 'out_for_delivery')
        and o.created_at < now() - make_interval(hours => $1)
      order by o.created_at`,
    [hours, DEMO_PHONE_LIKE],
  );
  const demo = stale.filter((o) => o.demo === true);
  const skipped = stale.length - demo.length;

  const { rows: mark } = await client.query(
    'select coalesce(max(id), 0)::bigint as id from public.notification_outbox',
  );

  for (const o of demo) {
    console.log(
      `CANCEL #${o.order_number} ${o.status} since ${o.created_at.toISOString()} (بلوك ${o.block} · بناية ${o.building})`,
    );
    await client.query('savepoint one');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: adminId, role: 'authenticated', aal: 'aal2' }),
    ]);
    await client.query('set local role authenticated');
    // out_for_delivery: البضاعة مع السائق، لكن بيانات العرض وهمية: يُرجع المخزون أيضاً (p_return_stock = true)
    await client.query(`select public.set_order_status($1, 'cancelled', $2, true)`, [o.id, REASON]);
    await client.query('reset role');
    await client.query(`select set_config('request.jwt.claims', '', true)`);
    await client.query('release savepoint one');
  }

  const ids = demo.map((o) => o.id);
  const dropped = ids.length
    ? await client.query(
        `delete from public.notification_outbox
          where id > $1 and data ->> 'order_id' = any($2::text[])`,
        [mark[0].id, ids],
      )
    : { rowCount: 0 };

  await client.query(apply ? 'commit' : 'rollback');
  console.log(
    `${stale.length} stale; cancelled ${demo.length} demo order(s) (stock returned), ` +
      `dropped ${dropped.rowCount} cancel notification(s); left ${skipped} non-demo order(s) untouched` +
      (apply ? '' : ' (dry run, nothing changed)'),
  );
} catch (err) {
  await client.query('rollback').catch(() => {});
  throw err;
} finally {
  await client.end();
}
