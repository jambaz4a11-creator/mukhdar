// اختبار تكامل T19 على mukhdar-dev فقط: pnpm it:admin-users
//
// الدالتان المنشورتان admin-reset-pin وadmin-create-user بحسابات مؤقتة (أرقام بالبادئة 9647007):
//   أدمن مؤقت (دوره يُضبط مباشرة بالقاعدة) يدخل بالهاتف + PIN بالمفتاح المنشور (كاللوحة)؛
//   admin-reset-pin: بلا JWT ← 401، زبون ← 403، هدف أدمن ← 403، رمز سهل ← 400، نجاح ← 200:
//     الرمز القديم يفشل والجديد ينجح، ورمز التحديث القديم لا يتجدد، وسطر pin_resets بلا الرمز.
//   admin-create-user: سائق برقم جديد ← 201، يدخل بالرمز المؤقت ودوره driver ويظهر بـ list_drivers،
//     سطر user_creations؛ نفس الرقم ← 409 PHONE_TAKEN بلا حساب ثانٍ؛ دور admin ← 400.
// يحذف كل الحسابات وسطور التدقيق التي أنشأها حتى عند الفشل. لا يطبع الرموز ولا المفاتيح.
// يحتاج: .env.local (SUPABASE_DB_PASSWORD، SUPABASE_SERVICE_ROLE_KEY)، apps/customer/.env (المفتاح المنشور).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertSafeTarget,
  connect,
  describe,
  readEnvLocal,
  resolveTarget,
  root,
} from './lib/db.mjs';

const target = resolveTarget(['--remote']);
assertSafeTarget(target);
const serviceKey = readEnvLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (.env.local)');
const appEnv = fs.readFileSync(path.join(root, 'apps', 'customer', '.env'), 'utf8');
const publishableKey = /^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.+)$/m.exec(appEnv)?.[1]?.trim();
if (!publishableKey)
  throw new Error('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing (apps/customer/.env)');
const base = `https://${target.projectRef}.supabase.co`;

const db = await connect(target);
console.log(`target: ${describe(target)}`);

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok    ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
};

async function request(url, { method = 'POST', key = publishableKey, token, body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token ?? key}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const authAdmin = (method, pathname, body) =>
  request(`${base}/auth/v1${pathname}`, { method, key: serviceKey, body });
const signIn = (phone, pin) =>
  request(`${base}/auth/v1/token?grant_type=password`, {
    body: { phone: `+${phone}`, password: pin },
  });
const fn = (name, token, body) => request(`${base}/functions/v1/${name}`, { token, body });
const brief = (r) =>
  `${r.status} ${JSON.stringify(r.json?.error ? { error: r.json.error } : r.json)}`;

const newPhone = () => `9647007${String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')}`;
/** 6 أرقام عشوائية بلا تكرار ولا تسلسل (الخادم يطبّق validatePin كاملة). */
function newPin() {
  for (;;) {
    const pin = Array.from({ length: 6 }, () => crypto.randomInt(0, 10)).join('');
    const d = [...pin].map(Number);
    const repeats = [1, 2, 3].some((p) => d.every((x, i) => x === d[i % p]));
    const seq = [1, -1].some((s) => d.every((x, i) => i === 0 || x - d[i - 1] === s));
    if (!repeats && !seq) return pin;
  }
}

const created = []; // auth user ids
const phones = [];

async function createAuthUser(phone, pin, role) {
  const r = await authAdmin('POST', '/admin/users', {
    phone,
    password: pin,
    phone_confirm: true,
    user_metadata: { purpose: 'T19 integration test' },
  });
  if (r.status !== 200) throw new Error(`createUser: ${brief(r)}`);
  created.push(r.json.id);
  phones.push(phone);
  await db.query(`update public.profiles set role = $2, full_name = $3 where id = $1`, [
    r.json.id,
    role,
    `T19 throwaway ${role}`,
  ]);
  return r.json.id;
}

let adminId = null;
try {
  // ---------------------------------------------------------------- التجهيز
  const adminPhone = newPhone();
  const adminPin = newPin();
  adminId = await createAuthUser(adminPhone, adminPin, 'admin');
  const adminSession = await signIn(adminPhone, adminPin);
  if (adminSession.status !== 200) throw new Error(`admin sign-in: ${brief(adminSession)}`);
  const adminJwt = adminSession.json.access_token;

  const custPhone = newPhone();
  const oldPin = newPin();
  const custId = await createAuthUser(custPhone, oldPin, 'customer');
  const custSession = await signIn(custPhone, oldPin);
  if (custSession.status !== 200) throw new Error(`customer sign-in: ${brief(custSession)}`);
  console.log('throwaway admin and customer signed in with phone + PIN');

  // ---------------------------------------------------------------- admin-reset-pin
  const body = { user_id: custId, new_pin: newPin() };
  const noJwt = await fn('admin-reset-pin', null, body);
  check(noJwt.status === 401, `reset: no JWT → 401 (${noJwt.status})`);
  const asCustomer = await fn('admin-reset-pin', custSession.json.access_token, body);
  check(
    asCustomer.status === 403 && asCustomer.json?.error === 'NOT_ALLOWED',
    `reset: customer JWT → 403 NOT_ALLOWED (${brief(asCustomer)})`,
  );
  const self = await fn('admin-reset-pin', adminJwt, { user_id: adminId, new_pin: newPin() });
  check(
    self.status === 403 && self.json?.error === 'ADMIN_ACCOUNT',
    `reset: admin target → 403 ADMIN_ACCOUNT (${brief(self)})`,
  );
  const easy = await fn('admin-reset-pin', adminJwt, { user_id: custId, new_pin: '123456' });
  check(
    easy.status === 400 &&
      easy.json?.error === 'PIN_INVALID' &&
      easy.json?.detail === 'PIN_TRIVIAL',
    `reset: easy PIN → 400 PIN_INVALID/PIN_TRIVIAL (${brief(easy)})`,
  );
  const ok = await fn('admin-reset-pin', adminJwt, body);
  check(
    ok.status === 200 && ok.json?.ok === true,
    `reset: success → 200 {ok: true} (${ok.status})`,
  );
  check(!JSON.stringify(ok.json).includes(body.new_pin), 'reset: the PIN is not in the response');

  const withOld = await signIn(custPhone, oldPin);
  check(withOld.status === 400, `old PIN no longer signs in (${withOld.status})`);
  const withNew = await signIn(custPhone, body.new_pin);
  check(withNew.status === 200, `new PIN signs in (${withNew.status})`);
  const refreshed = await request(`${base}/auth/v1/token?grant_type=refresh_token`, {
    body: { refresh_token: custSession.json.refresh_token },
  });
  check(refreshed.status !== 200, `old refresh token is revoked (${refreshed.status})`);
  const audit = await db.query(
    `select count(*)::int n from public.pin_resets where user_id = $1 and reset_by = $2`,
    [custId, adminId],
  );
  check(audit.rows[0].n === 1, 'one pin_resets row (customer, admin)');

  // ---------------------------------------------------------------- الرمز المؤقت (migration 20261123000001)
  const flag = async (id) =>
    (await db.query(`select must_change_pin from public.profiles where id = $1`, [id])).rows[0]
      ?.must_change_pin;
  check((await flag(custId)) === true, 'reset sets must_change_pin');
  check(
    (await flag(custId)) === true,
    'signing in with the temporary PIN does not clear the flag (GoTrue does not rewrite the hash)',
  );
  const blocked = await request(`${base}/rest/v1/rpc/place_order`, {
    token: withNew.json?.access_token,
    body: {
      p_address_id: crypto.randomUUID(),
      p_items: [],
      p_idempotency_key: crypto.randomUUID(),
    },
  });
  check(
    blocked.status !== 200 && JSON.stringify(blocked.json).includes('PIN_CHANGE_REQUIRED'),
    `flagged customer: place_order → PIN_CHANGE_REQUIRED (${blocked.status})`,
  );
  const changedPin = newPin();
  const changed = await request(`${base}/auth/v1/user`, {
    method: 'PUT',
    token: withNew.json?.access_token,
    body: { password: changedPin },
  });
  check(changed.status === 200, `customer changes the PIN with updateUser (${changed.status})`);
  check((await flag(custId)) === false, 'a real PIN change clears must_change_pin');

  // ---------------------------------------------------------------- admin-create-user
  const driverPhone = newPhone();
  const tempPin = newPin();
  phones.push(driverPhone);
  const createBody = {
    phone: `0${driverPhone.slice(3)}`,
    full_name: 'T19 throwaway driver',
    role: 'driver',
    pin: tempPin,
  };
  const badRole = await fn('admin-create-user', adminJwt, { ...createBody, role: 'admin' });
  check(
    badRole.status === 400 && badRole.json?.error === 'INVALID_ROLE',
    `create: role admin → 400 INVALID_ROLE (${brief(badRole)})`,
  );
  const made = await fn('admin-create-user', adminJwt, createBody);
  check(
    made.status === 201 && typeof made.json?.user_id === 'string',
    `create: driver → 201 (${made.status})`,
  );
  if (made.json?.user_id) created.push(made.json.user_id);
  const driverId = made.json?.user_id;

  const driverSession = await signIn(driverPhone, tempPin);
  check(
    driverSession.status === 200,
    `new driver signs in with the temporary PIN (${driverSession.status})`,
  );
  const prof = await db.query(
    `select role::text, full_name, is_active from public.profiles where id = $1`,
    [driverId],
  );
  check(
    prof.rows[0]?.role === 'driver' && prof.rows[0]?.is_active === true,
    `profile is an active driver (${JSON.stringify(prof.rows[0] ?? null)})`,
  );
  const drivers = await request(`${base}/rest/v1/rpc/list_drivers`, { token: adminJwt, body: {} });
  check(
    drivers.status === 200 && drivers.json.some((d) => d.id === driverId),
    'new driver is in list_drivers (assignment list)',
  );
  const creation = await db.query(
    `select role::text from public.user_creations where user_id = $1 and created_by = $2`,
    [driverId, adminId],
  );
  check(creation.rows[0]?.role === 'driver', 'user_creations row (driver, admin)');
  const driverFlag = await db.query(`select must_change_pin from public.profiles where id = $1`, [
    driverId,
  ]);
  check(driverFlag.rows[0]?.must_change_pin === true, 'new driver must change the temporary PIN');
  const driverBlocked = await request(`${base}/rest/v1/rpc/available_orders`, {
    token: driverSession.json?.access_token,
    body: {},
  });
  check(
    driverBlocked.status !== 200,
    `flagged driver: available_orders refused (${driverBlocked.status})`,
  );
  const driverChange = await request(`${base}/auth/v1/user`, {
    method: 'PUT',
    token: driverSession.json?.access_token,
    body: { password: newPin() },
  });
  check(driverChange.status === 200, `driver changes the PIN (${driverChange.status})`);
  const driverOk = await request(`${base}/rest/v1/rpc/available_orders`, {
    token: driverSession.json?.access_token,
    body: {},
  });
  check(driverOk.status === 200, `after the change: available_orders works (${driverOk.status})`);

  const hits = () =>
    db
      .query(
        `select count(*)::int n from public.admin_function_hits where admin_id = $1 and kind = 'user_creation'`,
        [adminId],
      )
      .then((r) => r.rows[0].n);
  const hitsBefore = await hits();
  const dup = await fn('admin-create-user', adminJwt, { ...createBody, pin: newPin() });
  check(
    dup.status === 409 && dup.json?.error === 'PHONE_TAKEN',
    `create: same phone → 409 PHONE_TAKEN (${brief(dup)})`,
  );
  check(
    (await hits()) === hitsBefore + 1,
    'create: the failed 409 attempt is counted by the rate limit too (L3)',
  );
  const count = await db.query(`select count(*)::int n from auth.users where phone = $1`, [
    driverPhone,
  ]);
  check(count.rows[0].n === 1, 'no second account for the same phone');

  // ---------------------------------------------------------------- أدمن برمز مؤقت (مراجعة T16-T19)
  await db.query(`update public.profiles set must_change_pin = true where id = $1`, [adminId]);
  const hitsFlagged = await hits();
  const flaggedCreate = await fn('admin-create-user', adminJwt, {
    ...createBody,
    phone: newPhone(),
    pin: newPin(),
  });
  check(
    flaggedCreate.status === 403 && flaggedCreate.json?.error === 'PIN_CHANGE_REQUIRED',
    `flagged admin: admin-create-user → 403 PIN_CHANGE_REQUIRED (${brief(flaggedCreate)})`,
  );
  const flaggedReset = await fn('admin-reset-pin', adminJwt, {
    user_id: custId,
    new_pin: newPin(),
  });
  check(
    flaggedReset.status === 403 && flaggedReset.json?.error === 'PIN_CHANGE_REQUIRED',
    `flagged admin: admin-reset-pin → 403 PIN_CHANGE_REQUIRED (${brief(flaggedReset)})`,
  );
  check(
    (await hits()) === hitsFlagged,
    'flagged admin: refused before the rate limit and any change',
  );
  await db.query(`update public.profiles set must_change_pin = false where id = $1`, [adminId]);
  const unflaggedReset = await fn('admin-reset-pin', adminJwt, {
    user_id: custId,
    new_pin: newPin(),
  });
  check(
    unflaggedReset.status === 200,
    `after the PIN change the admin works again (${brief(unflaggedReset)})`,
  );
} catch (err) {
  console.error(`error: ${err.message}`);
  failures++;
} finally {
  // التنظيف: سطور التدقيق ثم الحسابات (كل ما أنشأه هذا التشغيل فقط)
  if (adminId) {
    await db.query(`delete from public.pin_resets where reset_by = $1`, [adminId]);
    await db.query(`delete from public.user_creations where created_by = $1`, [adminId]);
    await db.query(`delete from public.admin_function_hits where admin_id = $1`, [adminId]);
  }
  for (const id of created) {
    const del = await authAdmin('DELETE', `/admin/users/${id}`);
    if (del.status !== 200) console.log(`cleanup: delete ${id} → ${del.status}`);
  }
  const left = await db.query(`select count(*)::int n from auth.users where phone = any ($1)`, [
    phones,
  ]);
  check(left.rows[0].n === 0, `cleanup: no throwaway user left (${phones.length} numbers)`);
  await db.end();
}

console.log(
  failures ? `\n${failures} check(s) failed` : '\nall admin-users integration checks passed',
);
process.exit(failures ? 1 : 0);
