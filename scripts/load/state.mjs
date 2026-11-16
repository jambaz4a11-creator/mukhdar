// T22: لقطة الحالة قبل الاختبار، والتنظيف الكامل بعده، والتحقق من صفر مخلّفات. mukhdar-dev فقط.
import fs from 'node:fs';
import path from 'node:path';
import { http, LOAD_PHONE_PREFIX, RUN_DIR, sleep } from './lib.mjs';

export const LT_NAME = 'LOADTEST'; // بادئة اسم تصنيف ومنتجات الحمل
const BEFORE_FILE = path.join(RUN_DIR, 'before.json');

const q = (db, sql, params) => db.query(sql, params).then((r) => r.rows);

/** جداول لا نقارن عدد صفوفها (سجلات بنية تحتية تُحذف تلقائياً، لا بيانات عمل). */
const AUTH_TABLES = [
  'auth.users',
  'auth.identities',
  'auth.sessions',
  'auth.refresh_tokens',
  'auth.audit_log_entries',
];

export async function takeSnapshot(db) {
  const tables = (
    await q(
      db,
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    )
  ).map((r) => `public.${r.table_name}`);
  const counts = {};
  for (const t of [...tables, ...AUTH_TABLES, 'storage.objects']) {
    counts[t] = Number((await q(db, `select count(*)::bigint as n from ${t}`))[0].n);
  }
  const hash = async (sql) => (await q(db, sql))[0].h;
  const hashes = {
    app_settings: await hash(
      `select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), '')) h from public.app_settings t`,
    ),
    stock: await hash(
      `select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by product_id), '')) h from public.stock t`,
    ),
    products: await hash(
      `select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), '')) h from public.products t`,
    ),
    product_costs: await hash(
      `select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by product_id), '')) h from public.product_costs t`,
    ),
    profiles: await hash(
      `select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), '')) h from public.profiles t`,
    ),
    orders: await hash(
      `select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), '')) h from public.orders t`,
    ),
    inventory_movements: await hash(
      `select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), '')) h from public.inventory_movements t`,
    ),
    // updated_at يُستثنى: إعادة البناء تكتبه (نعيده صراحة بالتنظيف، ونقارنه منفصلاً)
    daily_stats_full: await hash(
      `select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by day), '')) h from public.daily_stats t`,
    ),
    daily_stats: await hash(
      `select md5(coalesce(string_agg((to_jsonb(t) - 'updated_at')::text, '|' order by day), '')) h from public.daily_stats t`,
    ),
  };
  const outboxMax = Number(
    (await q(db, `select coalesce(max(id), 0)::bigint as m from public.notification_outbox`))[0].m,
  );
  // طوابع الوقت كنص (دقة الميكروثانية تضيع بـ Date بجافاسكربت)
  const appSettings = await q(
    db,
    `select a.*, a.updated_at::text as updated_at_text from public.app_settings a order by id`,
  );
  const dailyStats = await q(
    db,
    `select d.day::text as day, d.updated_at::text as updated_at_text from public.daily_stats d order by day`,
  );
  return {
    takenAt: new Date().toISOString(),
    counts,
    hashes,
    outboxMax,
    pushTokens: counts['public.push_tokens'],
    appSettings,
    dailyStatsRows: dailyStats,
  };
}

export function saveBefore(snapshot, extra = {}) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(BEFORE_FILE, JSON.stringify({ ...snapshot, ...extra }, null, 2));
}
export const loadBefore = () =>
  fs.existsSync(BEFORE_FILE) ? JSON.parse(fs.readFileSync(BEFORE_FILE, 'utf8')) : null;

/** فروقات بين لقطتين (counts وhashes). قائمة فارغة = مطابقة تامة. */
export function diffSnapshots(before, after) {
  const diffs = [];
  for (const [t, n] of Object.entries(before.counts)) {
    if (after.counts[t] !== n) diffs.push(`row count ${t}: before ${n}, after ${after.counts[t]}`);
  }
  for (const [k, h] of Object.entries(before.hashes)) {
    if (after.hashes[k] !== h) diffs.push(`content hash differs: ${k}`);
  }
  return diffs;
}

/** يبدّل store_open دون تغيير updated_at (يعطّل trigger التحديث داخل معاملة قصيرة). */
export async function setStoreOpen(db, open) {
  await db.query('begin');
  try {
    await db.query('alter table public.app_settings disable trigger app_settings_updated_at');
    await db.query('update public.app_settings set store_open = $1 where id = 1', [open]);
    await db.query('alter table public.app_settings enable trigger app_settings_updated_at');
    await db.query('commit');
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  }
}

/** يعيد صف app_settings كما كان بالضبط (كل الأعمدة بما فيها updated_at). */
export async function restoreAppSettings(db, rows) {
  if (!rows?.length) return;
  const r = rows[0];
  await db.query('begin');
  try {
    await db.query('alter table public.app_settings disable trigger app_settings_updated_at');
    await db.query(
      `update public.app_settings set delivery_fee_iqd = $1, min_order_iqd = $2, store_open = $3, closed_message = $4,
              updated_at = $5::timestamptz, max_active_orders = $6 where id = $7`,
      [
        r.delivery_fee_iqd,
        r.min_order_iqd,
        r.store_open,
        r.closed_message,
        r.updated_at_text,
        r.max_active_orders,
        r.id,
      ],
    );
    await db.query('alter table public.app_settings enable trigger app_settings_updated_at');
    await db.query('commit');
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  }
}

/**
 * تنظيف كامل (آمن لإعادة التشغيل). يعثر على بيانات الحمل بـ: بادئة الهاتف 9647006 وأسماء LOADTEST.
 * الترتيب: إشعارات ← حركات مخزون ← طلبات ← عناوين ← منتجات/تصنيف ← مستخدمون (Admin API) ← daily_stats/الإعدادات.
 */
export async function cleanup(db, env, before, log = console.log) {
  const users = (
    await q(db, `select id from auth.users where phone like $1`, [`${LOAD_PHONE_PREFIX}%`])
  ).map((r) => r.id);
  const prods = (
    await q(db, `select id from public.products where name like $1`, [`${LT_NAME}%`])
  ).map((r) => r.id);
  const orders = (
    await q(
      db,
      `select id from public.orders where customer_id = any ($1) or driver_id = any ($1)
        or id in (select order_id from public.order_items where product_id = any ($2))`,
      [users, prods],
    )
  ).map((r) => r.id);
  const startDay = (
    await q(
      db,
      `select (min(created_at) at time zone 'Asia/Baghdad')::date as d from public.orders where id = any ($1)`,
      [orders],
    )
  )[0]?.d;
  log(`cleanup: ${users.length} users, ${prods.length} products, ${orders.length} orders`);

  // المتجر أولاً (حتى لو فشل ما بعده يبقى مفتوحاً كما كان)
  if (before?.appSettings) await restoreAppSettings(db, before.appSettings);

  const del = async (label, sql, params) => {
    const r = await db.query(sql, params);
    log(`  deleted ${String(r.rowCount).padStart(5)} ${label}`);
  };
  await del(
    'notification_outbox (load orders / users / products)',
    `delete from public.notification_outbox where user_id = any ($1)
        or data ->> 'order_id' = any ($2::text[]) or data ->> 'product_id' = any ($3::text[])`,
    [users, orders, prods],
  );
  await del(
    'inventory_movements',
    `delete from public.inventory_movements where product_id = any ($1) or order_id = any ($2) or created_by = any ($3)`,
    [prods, orders, users],
  );
  await del(
    'orders (cascades items, costs, history, ratings)',
    `delete from public.orders where id = any ($1)`,
    [orders],
  );
  await del('addresses', `delete from public.addresses where customer_id = any ($1)`, [users]);
  await del('push_tokens (load users)', `delete from public.push_tokens where user_id = any ($1)`, [
    users,
  ]);
  await del('products (cascades stock, costs)', `delete from public.products where id = any ($1)`, [
    prods,
  ]);
  await del('categories', `delete from public.categories where name like $1`, [`${LT_NAME}%`]);

  // المستخدمون: Admin API (يحذف الهويات والجلسات والرموز)، وللمتبقي SQL
  let apiDeleted = 0;
  for (let i = 0; i < users.length; i += 8) {
    const batch = users.slice(i, i + 8);
    const rs = await Promise.all(
      batch.map((id) =>
        http('DELETE', `${env.base}/auth/v1/admin/users/${id}`, { key: env.serviceKey }),
      ),
    );
    apiDeleted += rs.filter((r) => r.status === 200).length;
  }
  const left = (
    await q(db, `select id from auth.users where phone like $1`, [`${LOAD_PHONE_PREFIX}%`])
  ).map((r) => r.id);
  if (left.length)
    await del('auth.users (SQL fallback)', `delete from auth.users where id = any ($1)`, [left]);
  log(`  deleted ${apiDeleted} users via Admin API`);

  // daily_stats: إعادة بناء الأيام المتأثرة من المصدر ثم updated_at كما كان
  if (startDay && before) {
    await db.query(`select private.rebuild_daily_stats($1::date, public.baghdad_today())`, [
      startDay,
    ]);
    const rows = before.dailyStatsRows ?? [];
    for (const r of rows) {
      await db.query(
        `update public.daily_stats set updated_at = $2::timestamptz where day = $1::date and updated_at is distinct from $2::timestamptz`,
        [r.day, r.updated_at_text],
      );
    }
    // أي يوم ظهر بعد إعادة البناء ولم يكن باللقطة يُحذف
    await db.query(`delete from public.daily_stats where day <> all ($1::date[])`, [
      rows.map((r) => r.day),
    ]);
  }
  await sleep(0);
  return { users: users.length, products: prods.length, orders: orders.length };
}

/** تحقق نهائي: لا مخلّفات بالأسماء، وكل شيء يطابق اللقطة. */
export async function verifyClean(db, before) {
  const problems = [];
  const n = async (sql, params) => Number((await q(db, sql, params))[0].n);
  const users = await n(`select count(*) n from auth.users where phone like $1`, [
    `${LOAD_PHONE_PREFIX}%`,
  ]);
  if (users) problems.push(`${users} throwaway auth.users left`);
  const profiles = await n(
    `select count(*) n from public.profiles where phone like $1 or full_name like 'LOADTEST%'`,
    [`${LOAD_PHONE_PREFIX}%`],
  );
  if (profiles) problems.push(`${profiles} throwaway profiles left`);
  const products = await n(`select count(*) n from public.products where name like $1`, [
    `${LT_NAME}%`,
  ]);
  if (products) problems.push(`${products} LOADTEST products left`);
  const cats = await n(`select count(*) n from public.categories where name like $1`, [
    `${LT_NAME}%`,
  ]);
  if (cats) problems.push(`${cats} LOADTEST categories left`);
  if (before) {
    const outbox = await n(`select count(*) n from public.notification_outbox where id > $1`, [
      before.outboxMax,
    ]);
    if (outbox)
      problems.push(`${outbox} notification_outbox rows created since the run started remain`);
    const tokens = await n(`select count(*) n from public.push_tokens`);
    if (tokens !== before.pushTokens)
      problems.push(`push_tokens ${tokens} != ${before.pushTokens}`);
    problems.push(...diffSnapshots(before, await takeSnapshot(db)));
  }
  return problems;
}
