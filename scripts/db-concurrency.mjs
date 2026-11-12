#!/usr/bin/env node
// اختبار تزامن حقيقي (اتصالات متعددة) لـ place_order و accept_order. للقاعدة المحلية فقط (CI).
//
//   pnpm db:concurrency
//
// pgTAP يعمل باتصال واحد داخل معاملة، فلا يختبر التزامن. هنا:
//   1) 40 زبوناً يطلبون نفس المنتج (رصيد 10) بنفس اللحظة: 10 تنجح بالضبط، الرصيد 0،
//      الباقي INSUFFICIENT_STOCK، صفر deadlocks.
//   2) 8 سائقين يقبلون نفس الطلب بنفس اللحظة: واحد ينجح، الباقي ORDER_NOT_AVAILABLE.
// "نفس اللحظة": كل عامل ينتظر قفلاً استشارياً يمسكه المنسّق، ثم يُطلق الجميع معاً.
// البيانات تُنشأ فعلاً (commit) ثم تُحذف بالنهاية، لذلك يُرفض أي هدف غير محلي.
import pg from 'pg';
import { assertSafeTarget, connectionConfig, describe, resolveTarget } from './lib/db.mjs';

const CUSTOMERS = 40;
const STOCK = 10;
const DRIVERS = 8;
const BARRIER = 7_730_001; // مفتاح القفل الاستشاري
const PREFIX = '9647002'; // بادئة أرقام مستخدمي هذا الاختبار (لا تتبع أي شركة)

const target = resolveTarget();
if (target.kind !== 'local') {
  console.error(
    'Refusing: db:concurrency commits test data; it runs against a local database only.',
  );
  process.exit(1);
}
assertSafeTarget(target);

const newClient = async () => {
  const c = new pg.Client(connectionConfig(target));
  await c.connect();
  return c;
};

const admin = await newClient();
const q = (sql, params) => admin.query(sql, params);
console.log(`target: ${describe(target)}`);

const ids = { users: [], product: null, category: null, sector: null, orders: [] };

async function createUsers(role, count, offset) {
  const phones = Array.from(
    { length: count },
    (_, i) => `${PREFIX}${String(offset + i).padStart(6, '0')}`,
  );
  const { rows } = await q(
    `insert into auth.users (id, phone, aud, role)
     select gen_random_uuid(), p, 'authenticated', 'authenticated' from unnest($1::text[]) p
     returning id`,
    [phones],
  );
  const userIds = rows.map((r) => r.id);
  await q(
    `update public.profiles set role = $1::public.user_role, full_name = $1::text || ' (concurrency)' where id = any ($2)`,
    [role, userIds],
  );
  ids.users.push(...userIds);
  return userIds;
}

/** يشغّل fn لكل عامل باتصال مستقل، ويطلقهم جميعاً بنفس اللحظة. يرجع 'OK' أو رمز الخطأ لكل عامل. */
async function race(actors, fn, role = 'authenticated') {
  const clients = await Promise.all(actors.map(() => newClient()));
  await q('select pg_advisory_lock($1)', [BARRIER]);
  const runs = clients.map(async (c, i) => {
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: actors[i], role }),
      ]);
      await c.query(`set local role ${role}`);
      await c.query('select pg_advisory_xact_lock_shared($1)', [BARRIER]);
      await fn(c, i);
      await c.query('commit');
      return 'OK';
    } catch (err) {
      await c.query('rollback').catch(() => {});
      return err.code === '40P01' ? 'DEADLOCK' : err.message;
    }
  });
  // انتظر حتى يصطف كل العمال على القفل، ثم أطلقهم
  for (let i = 0; i < 100; i++) {
    const { rows } = await q(
      `select count(*)::int as n from pg_locks where locktype = 'advisory' and objid = $1 and not granted`,
      [BARRIER],
    );
    if (rows[0].n >= actors.length) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await q('select pg_advisory_unlock($1)', [BARRIER]);
  const results = await Promise.all(runs);
  await Promise.all(clients.map((c) => c.end()));
  return results;
}

const tally = (results) =>
  results.reduce(
    (m, r) => ({ ...m, [r]: (m[r] ?? 0) + 1 }),
    /** @type {Record<string, number>} */ ({}),
  );

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok    ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
};

try {
  const { rows: existing } = await q(
    `select count(*)::int as n from public.profiles where phone like $1`,
    [`${PREFIX}%`],
  );
  if (existing[0].n > 0)
    throw new Error(`leftover users with prefix ${PREFIX}; clean them up first`);

  // التجهيز
  await q(`update public.app_settings set store_open = true, min_order_iqd = 0`);
  ids.sector = (
    await q(
      `insert into public.sectors (name) values ('concurrency ' || gen_random_uuid()) returning id`,
    )
  ).rows[0].id;
  const sub = (
    await q(`insert into public.subsections (sector_id, name) values ($1, 'A') returning id`, [
      ids.sector,
    ])
  ).rows[0].id;
  const building = (
    await q(`insert into public.buildings (subsection_id, number) values ($1, '1') returning id`, [
      sub,
    ])
  ).rows[0].id;
  ids.category = (
    await q(`insert into public.categories (name) values ('concurrency') returning id`)
  ).rows[0].id;
  ids.product = (
    await q(
      `insert into public.products (category_id, name, unit, price_iqd) values ($1, 'concurrency', 'كيلو', 1000) returning id`,
      [ids.category],
    )
  ).rows[0].id;
  await q(`update public.stock set qty = $1 where product_id = $2`, [STOCK, ids.product]);

  const customers = await createUsers('customer', CUSTOMERS, 1);
  const drivers = await createUsers('driver', DRIVERS, 1001);
  const { rows: addrRows } = await q(
    `insert into public.addresses (customer_id, building_id, apartment)
     select c, $2::int, '1' from unnest($1::uuid[]) c returning customer_id, id`,
    [customers, building],
  );
  const addressOf = new Map(addrRows.map((r) => [r.customer_id, r.id]));

  // 1) آخر الوحدات: 40 طلباً متزامناً على رصيد 10
  const orderResults = await race(customers, (c, i) =>
    c.query(`select public.place_order($1, $2, gen_random_uuid())`, [
      addressOf.get(customers[i]),
      JSON.stringify([{ product_id: ids.product, qty: 1 }]),
    ]),
  );
  const t1 = tally(orderResults);
  console.log('place_order results:', t1);
  const { rows: stockRows } = await q(`select qty from public.stock where product_id = $1`, [
    ids.product,
  ]);
  const { rows: orderRows } = await q(
    `select o.id from public.orders o join public.order_items i on i.order_id = o.id where i.product_id = $1`,
    [ids.product],
  );
  ids.orders.push(...orderRows.map((r) => r.id));
  check(t1.OK === STOCK, `exactly ${STOCK} of ${CUSTOMERS} concurrent orders succeed`);
  check(
    t1.INSUFFICIENT_STOCK === CUSTOMERS - STOCK,
    `the other ${CUSTOMERS - STOCK} get INSUFFICIENT_STOCK`,
  );
  check(!t1.DEADLOCK, 'no deadlocks');
  check(stockRows[0].qty === 0, 'stock ends at 0 (never negative)');
  check(orderRows.length === STOCK, `${STOCK} orders exist in the database`);

  // 2) نفس الطلب يقبله 8 سائقين بنفس اللحظة
  const contested = ids.orders[0];
  const acceptResults = await race(drivers, (c) =>
    c.query(`select public.accept_order($1)`, [contested]),
  );
  const t2 = tally(acceptResults);
  console.log('accept_order results:', t2);
  const { rows: assigned } = await q(`select driver_id from public.orders where id = $1`, [
    contested,
  ]);
  check(t2.OK === 1, 'exactly one driver gets the order');
  check(t2.ORDER_NOT_AVAILABLE === DRIVERS - 1, `the other ${DRIVERS - 1} get ORDER_NOT_AVAILABLE`);
  check(
    drivers.includes(assigned[0].driver_id),
    'the order is assigned to one of the racing drivers',
  );

  // 3) push-dispatch: 4 عمال (service_role) يحجزون من الصندوق بنفس اللحظة ← مجموعات منفصلة
  const { rows: pendingRows } = await q(
    `select count(*)::int as n from public.notification_outbox
      where sent_at is null and attempts < 5 and claimed_at is null`,
  );
  const WORKERS = 4;
  const PER_WORKER = Math.max(1, Math.floor(pendingRows[0].n / 2));
  /** @type {number[][]} */
  const claimedBy = [];
  const claimResults = await race(
    Array.from({ length: WORKERS }, () => null),
    async (c, i) => {
      const { rows } = await c.query(`select id from public.claim_push_notifications($1::int)`, [
        PER_WORKER,
      ]);
      claimedBy[i] = rows.map((r) => Number(r.id));
    },
    'service_role',
  );
  const allClaimed = claimedBy.flat();
  console.log(
    'claim_push_notifications per worker:',
    claimedBy.map((r) => r.length),
  );
  check(tally(claimResults).OK === WORKERS, 'every worker claims without error');
  check(pendingRows[0].n >= 2, `outbox has pending rows to claim (${pendingRows[0].n})`);
  check(new Set(allClaimed).size === allClaimed.length, 'no outbox row is claimed by two workers');
  check(
    allClaimed.length === Math.min(pendingRows[0].n, WORKERS * PER_WORKER),
    'workers together claim every available row (skip locked, no waiting)',
  );
} catch (err) {
  console.error(`error: ${err.message}`);
  failures++;
} finally {
  // التنظيف: كل ما أنشأه هذا السكربت
  await q('begin');
  if (ids.orders.length) {
    await q(`delete from public.notification_outbox where data ->> 'order_id' = any ($1::text[])`, [
      ids.orders,
    ]);
    await q(`delete from public.inventory_movements where order_id = any ($1)`, [ids.orders]);
    await q(`delete from public.orders where id = any ($1)`, [ids.orders]);
  }
  if (ids.product) await q(`delete from public.products where id = $1`, [ids.product]);
  if (ids.category) await q(`delete from public.categories where id = $1`, [ids.category]);
  if (ids.users.length) await q(`delete from auth.users where id = any ($1)`, [ids.users]);
  if (ids.sector) {
    await q(
      `delete from public.buildings where subsection_id in (select id from public.subsections where sector_id = $1)`,
      [ids.sector],
    );
    await q(`delete from public.subsections where sector_id = $1`, [ids.sector]);
    await q(`delete from public.sectors where id = $1`, [ids.sector]);
  }
  await q('commit');
  await admin.end();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall concurrency checks passed');
process.exit(failures ? 1 : 0);
