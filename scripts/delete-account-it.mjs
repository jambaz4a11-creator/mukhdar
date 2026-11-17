// اختبار تكامل T08 على mukhdar-dev فقط: pnpm it:delete-account
//
// ينشئ مستخدماً مؤقتاً (رقم بالبادئة 9647005 + بريد t08-…@example.com، كلمة سر عشوائية، عبر
// Auth Admin API)، يسجّل دخوله بالبريد (دخول الهاتف معطّل بمشروع التطوير؛ لا نغيّر إعدادات Auth)،
// يجهّز طلبين له مباشرة بالقاعدة (لا مخزون ولا تقارير تتغير)، ثم يستدعي Edge Function المنشورة:
//   بدون JWT ← 401؛ طلب نشط ← 409 ACTIVE_ORDER؛ بعد إنهاء الطلب ← 200 والحساب محذوف؛
//   الطلبات باقية بـ customer_id = null؛ الجلسة القديمة لا تعمل.
// يحذف كل ما أنشأه (المستخدم والطلبين) حتى عند الفشل. لا يلمس أي مستخدم آخر.
// يحتاج بـ .env.local: SUPABASE_DB_PASSWORD و SUPABASE_SERVICE_ROLE_KEY (مشروع التطوير).
import crypto from 'node:crypto';
import { assertSafeTarget, connect, describe, readEnvLocal, resolveTarget } from './lib/db.mjs';

const target = resolveTarget(['--remote']);
assertSafeTarget(target);
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? readEnvLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (.env.local)');
const base = `https://${target.projectRef}.supabase.co`;
const fnUrl = `${base}/functions/v1/delete-account`;

const db = await connect(target);
console.log(`target: ${describe(target)}`);

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok    ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
};

/** طلب لـ Auth API بمفتاح الخدمة (لا يُطبع المفتاح). */
async function auth(method, pathname, { body, token } = {}) {
  const res = await fetch(`${base}/auth/v1${pathname}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${token ?? serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function callFunction(token) {
  const headers = { apikey: serviceKey, 'Content-Type': 'application/json' };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  else delete headers.apikey; // بلا أي ترويسة مصادقة
  const res = await fetch(fnUrl, { method: 'POST', headers, body: '{}' });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const phone = `9647005${String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')}`;
const email = `t08-${phone}@example.com`;
const password = crypto.randomBytes(24).toString('base64url');
let userId = null;
const orderIds = [];

try {
  const existing = await db.query(`select 1 from auth.users where phone = $1`, [phone]);
  if (existing.rowCount) throw new Error(`phone ${phone} already exists; rerun`);

  // 1) المستخدم المؤقت + جلسة حقيقية
  const created = await auth('POST', '/admin/users', {
    body: {
      phone,
      email,
      password,
      phone_confirm: true,
      email_confirm: true,
      user_metadata: { purpose: 'T08 integration test' },
    },
  });
  if (created.status !== 200)
    throw new Error(`createUser: ${created.status} ${JSON.stringify(created.json)}`);
  userId = created.json.id;
  await db.query(`update public.profiles set full_name = 'T08 throwaway' where id = $1`, [userId]);
  const session = await auth('POST', '/token?grant_type=password', { body: { email, password } });
  if (session.status !== 200)
    throw new Error(`sign-in: ${session.status} ${JSON.stringify(session.json)}`);
  const { access_token: accessToken, refresh_token: refreshToken } = session.json;
  console.log(`throwaway user ${userId} (phone ${phone}) signed in`);

  // 2) طلبان: مسلّم (قديم) ونشط. إدراج مباشر: لا مخزون ولا daily_stats.
  const snapshot = JSON.stringify({
    sector: 'IT',
    subsection: 'IT',
    building: '0',
    apartment: '0',
    note: null,
  });
  for (const status of ['delivered', 'pending']) {
    const { rows } = await db.query(
      `insert into public.orders (customer_id, address_snapshot, customer_name, customer_phone, status,
                                  subtotal_iqd, delivery_fee_iqd, total_iqd, idempotency_key, delivered_at)
       values ($1, $2::jsonb, 'T08 throwaway', $3, $4::public.order_status, 1000, 1000, 2000,
               gen_random_uuid(), case when $4 = 'delivered' then now() end)
       returning id`,
      [userId, snapshot, phone, status],
    );
    orderIds.push(rows[0].id);
    await db.query(
      `insert into public.order_items (order_id, name_snapshot, unit_snapshot, price_snapshot_iqd, qty, line_total_iqd)
       values ($1, 'T08 item', 'نص كيلو', 1000, 1, 1000)`,
      [rows[0].id],
    );
  }
  const [deliveredId, pendingId] = orderIds;

  // 3) الرفض
  const noAuth = await callFunction(undefined);
  check(noAuth.status === 401, `no JWT → 401 (${noAuth.status})`);
  const garbage = await callFunction('not-a-jwt');
  check(garbage.status === 401, `invalid JWT → 401 (${garbage.status})`);
  const busy = await callFunction(accessToken);
  check(
    busy.status === 409 && busy.json?.error === 'ACTIVE_ORDER',
    `active order → 409 ACTIVE_ORDER (${busy.status} ${JSON.stringify(busy.json)})`,
  );
  const stillActive = await db.query(`select is_active from public.profiles where id = $1`, [
    userId,
  ]);
  check(stillActive.rows[0]?.is_active === true, 'refused deletion leaves the account active');

  // 4) إنهاء الطلب النشط (مباشرة، بلا أثر على التقارير)، ثم الحذف
  await db.query(
    `update public.orders set status = 'cancelled', cancelled_at = now() where id = $1`,
    [pendingId],
  );
  const ok = await callFunction(accessToken);
  check(
    ok.status === 200 && ok.json?.deleted === true,
    `delete → 200 {deleted: true} (${ok.status})`,
  );

  // 5) بعد الحذف
  const gone = await auth('GET', `/admin/users/${userId}`);
  check(gone.status === 404, `auth user is gone (${gone.status})`);
  const profile = await db.query(`select 1 from public.profiles where id = $1`, [userId]);
  check(profile.rowCount === 0, 'profile is gone');
  const kept = await db.query(
    `select id, customer_id, customer_name, customer_phone, address_snapshot, total_iqd, status::text from public.orders where id = any ($1) order by status`,
    [orderIds],
  );
  check(kept.rowCount === 2, 'both orders are kept');
  check(
    kept.rows.every((r) => r.customer_id === null),
    'kept orders have customer_id = null',
  );
  // T23 M5: بيانات الزبون الشخصية تُمحى من الطلبات المحفوظة؛ يبقى القطاع والوحدة والمبالغ للمحاسبة
  const d = kept.rows.find((r) => r.id === deliveredId);
  check(
    d?.customer_name === null && d?.customer_phone === null,
    'delivered order: customer name and phone are removed (M5)',
  );
  const snap = d?.address_snapshot ?? {};
  check(
    snap.sector === 'IT' &&
      snap.subsection === 'IT' &&
      snap.building === undefined &&
      snap.apartment === undefined,
    'delivered order: only sector and unit remain in the address (M5)',
  );
  check(
    Number(d?.total_iqd) === 2000,
    'delivered order keeps its amounts (still counted by reports)',
  );
  const items = await db.query(
    `select count(*)::int n from public.order_items where order_id = $1`,
    [deliveredId],
  );
  check(items.rows[0].n === 1, 'order items are kept');
  const me = await auth('GET', '/user', { token: accessToken });
  check(me.status !== 200, `old access token no longer resolves a user (${me.status})`);
  const refreshed = await auth('POST', '/token?grant_type=refresh_token', {
    body: { refresh_token: refreshToken },
  });
  check(refreshed.status !== 200, `old refresh token is revoked (${refreshed.status})`);
  const again = await callFunction(accessToken);
  check(again.status === 401, `calling again with the old session → 401 (${again.status})`);
  userId = null; // محذوف
} catch (err) {
  console.error(`error: ${err.message}`);
  failures++;
} finally {
  // التنظيف: الطلبان (مع البنود والسجل) والمستخدم إن بقي
  if (orderIds.length) {
    await db.query(`delete from public.orders where id = any ($1)`, [orderIds]);
  }
  if (userId) {
    const del = await auth('DELETE', `/admin/users/${userId}`);
    console.log(`cleanup: deleted leftover throwaway user (${del.status})`);
  }
  const left = await db.query(
    `select count(*)::int n from auth.users where phone = $1 or email = $2`,
    [phone, email],
  );
  check(left.rows[0].n === 0, 'cleanup: no throwaway user left');
  await db.end();
}

console.log(
  failures ? `\n${failures} check(s) failed` : '\nall delete-account integration checks passed',
);
process.exit(failures ? 1 : 0);
