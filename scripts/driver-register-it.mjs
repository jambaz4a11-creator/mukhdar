// اختبار تكامل T28 على mukhdar-dev فقط: pnpm it:driver-register
//
// الدالتان المنشورتان driver-register وdriver-complete-registration بالمفتاح المنشور (مثل تطبيق السائق، بلا جلسة):
//   تسجيل ← لا حساب Auth، الحالة pending (rpc driver_request_status كـ anon) ← إعادة الإرسال بنفس السر = نفس
//   المعرّف، وبسر آخر 409 REQUEST_EXISTS ← الإكمال قبل الموافقة 409 REQUEST_NOT_APPROVED ← موافقة أدمن مؤقت
//   بجلسة aal2 (rpc decide_driver_request) ← سر خاطئ 404 بلا حساب ← رمز سهل 400 PIN_INVALID ← ضغطتان متزامنتان:
//   حساب واحد (201 + 409) ← signInWithPassword ← سائق فعّال بلا must_change_pin ← available_orders ← completed.
//   طلب مرفوض ← الإكمال 409 بلا حساب. CORS: preflight من أصل الويب المسموح ← 204، أصل غريب ← 403 بلا عمل.
//   حد الـ IP: ترويسات IP مزوّرة (cf-connecting-ip، x-forwarded-for، x-real-ip) لا تصير المفتاح ولا تتجاوز الحد.
// أرقام بالبادئة 9647008. يحذف كل ما أنشأه (الطلبات، الحسابات، سطور التدقيق والإشعارات، صفوف الحد) حتى عند
// الفشل، ويعيد صف حد الـ IP لقيمته. لا يطبع السر ولا الرمز ولا المفاتيح.
// يحتاج: .env.local (SUPABASE_DB_PASSWORD، SUPABASE_SERVICE_ROLE_KEY)، apps/customer/.env (المفتاح المنشور).
// **يرسل إشعار "طلب سائق جديد" لأجهزة أدمن dev** (admins_only) لكل طلب يُنشئه (اثنان)؛ الصفوف تُحذف بعدها.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertSafeTarget,
  connectDev,
  describe,
  readEnvLocal,
  resolveTarget,
  root,
} from './lib/db.mjs';
import { http, upgradeToAal2 } from './load/lib.mjs';

const target = resolveTarget(['--remote']);
assertSafeTarget(target);
const serviceKey = readEnvLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (.env.local)');
const appEnv = fs.readFileSync(path.join(root, 'apps', 'customer', '.env'), 'utf8');
const publishableKey = /^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.+)$/m.exec(appEnv)?.[1]?.trim();
if (!publishableKey)
  throw new Error('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing (apps/customer/.env)');
const base = `https://${target.projectRef}.supabase.co`;
const WEB_ORIGIN = process.env.IT_WEB_ORIGIN ?? 'http://localhost:3000';

const db = await connectDev(target);
console.log(`target: ${describe(target)}`);

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok    ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
};

async function request(url, { method = 'POST', token, body, headers = {} } = {}) {
  const h = { apikey: publishableKey, 'Content-Type': 'application/json', ...headers };
  h.Authorization = `Bearer ${token ?? publishableKey}`;
  const res = await fetch(url, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}
const brief = (r) =>
  `${r.status} ${typeof r.json === 'string' ? `${r.json.slice(0, 60)}…` : JSON.stringify(r.json?.error ? { error: r.json.error } : r.json)}`;
const register = (body, headers) =>
  request(`${base}/functions/v1/driver-register`, { body, headers });
const complete = (body) => request(`${base}/functions/v1/driver-complete-registration`, { body });
const rpc = (name, args, token) => request(`${base}/rest/v1/rpc/${name}`, { body: args, token });
const status = async (id, secret) =>
  (await rpc('driver_request_status', { p_request_id: id, p_device_secret: secret })).json;
const authAdmin = (method, pathname, body) =>
  fetch(`${base}/auth/v1${pathname}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const signIn = (phone, pin) =>
  request(`${base}/auth/v1/token?grant_type=password`, {
    body: { phone: `+${phone}`, password: pin },
  });

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const newPhone = () => `9647008${String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')}`;
const local = (phone) => `0${phone.slice(3)}`;
const newSecret = () => crypto.randomBytes(32).toString('base64url'); // 43 محرفاً، كالتطبيق
/** 6 أرقام بلا تكرار ولا تسلسل ولا من الرقم (الخادم يطبّق validatePin كاملة). */
function newPin(phone) {
  for (;;) {
    const pin = Array.from({ length: 6 }, () => crypto.randomInt(0, 10)).join('');
    const d = [...pin].map(Number);
    const repeats = [1, 2, 3].some((p) => d.every((x, i) => x === d[i % p]));
    const seq = [1, -1].some((s) => d.every((x, i) => i === 0 || x - d[i - 1] === s));
    if (!repeats && !seq && !phone.endsWith(pin) && !phone.slice(3).startsWith(pin)) return pin;
  }
}
const userCount = async (phone) =>
  (await db.query('select count(*)::int n from auth.users where phone = $1', [phone])).rows[0].n;

const phones = [];
const requestIds = [];
const userIds = [];

let ipRow = null; // {key_hash, hits, window_start, existed}

// صفوف حد الـ IP قبل التشغيل: لنعرف صفنا (العدّاد الذي يزيد) ونعيده بعدها
const ipBefore = new Map(
  (
    await db.query(
      `select key_hash, hits, window_start from private.driver_request_rate_limits where bucket = 'ip'`,
    )
  ).rows.map((r) => [r.key_hash, r]),
);

try {
  // ---------------------------------------------------------------- 1) التسجيل
  const p1 = newPhone();
  phones.push(p1);
  const s1 = newSecret();
  const r1 = await register({
    full_name: 'IT سائق مؤقت',
    phone: local(p1),
    device_secret: s1,
    push_token: 'ExponentPushToken[it-driver-register]',
  });
  check(
    r1.status === 201 && typeof r1.json?.request_id === 'string',
    `register → 201 (${brief(r1)})`,
  );
  const id1 = r1.json?.request_id;
  if (id1) requestIds.push(id1);

  // صف الـ IP لهذا الجهاز: الوحيد الذي زاد؛ يُصفَّر لـ 1 حتى لا يتأثر الفحص بتشغيلات سابقة بالساعة نفسها
  const ipNow = (
    await db.query(
      `select key_hash, hits, window_start from private.driver_request_rate_limits where bucket = 'ip'`,
    )
  ).rows;
  const mine = ipNow.filter((r) => {
    const old = ipBefore.get(r.key_hash);
    return !old || r.hits !== old.hits || +r.window_start !== +old.window_start;
  });
  check(mine.length === 1, `exactly one IP key moved (${mine.length})`);
  if (mine.length === 1) {
    const old = ipBefore.get(mine[0].key_hash);
    ipRow = {
      key_hash: mine[0].key_hash,
      existed: Boolean(old),
      hits: old?.hits,
      window_start: old?.window_start,
    };
    check(
      ![sha('unknown'), sha('203.0.113.70'), sha('203.0.113.71'), sha('203.0.113.72')].includes(
        ipRow.key_hash,
      ),
      'the IP key is the real client IP (not "unknown", not a forged value)',
    );
    await db.query(
      `update private.driver_request_rate_limits set hits = 1, window_start = now() where bucket = 'ip' and key_hash = $1`,
      [ipRow.key_hash],
    );
  }

  check((await userCount(p1)) === 0, 'driver-register creates no Auth account');
  check((await status(id1, s1)) === 'pending', 'anon status with the right secret → pending');
  check(
    (await status(id1, newSecret())) === 'not_found',
    'anon status with another secret → not_found',
  );

  const again = await register({ full_name: 'IT سائق مؤقت', phone: local(p1), device_secret: s1 });
  check(
    again.status === 201 && again.json?.request_id === id1,
    `same secret again → same id (${brief(again)})`,
  );
  const other = await register({
    full_name: 'IT جهاز ثاني',
    phone: local(p1),
    device_secret: newSecret(),
  });
  check(
    other.status === 409 && other.json?.error === 'REQUEST_EXISTS',
    `another device, same phone → 409 REQUEST_EXISTS (${brief(other)})`,
  );
  const stored = await db.query(
    `select device_secret_hash = $2 ok, push_token from public.driver_requests where id = $1`,
    [id1, sha(s1)],
  );
  check(stored.rows[0]?.ok === true, 'only the SHA-256 of the secret is stored');

  // ---------------------------------------------------------------- 2) قبل الموافقة
  const pin = newPin(p1);
  const early = await complete({ request_id: id1, device_secret: s1, pin });
  check(
    early.status === 409 && early.json?.error === 'REQUEST_NOT_APPROVED',
    `complete while pending → 409 REQUEST_NOT_APPROVED (${brief(early)})`,
  );
  check((await userCount(p1)) === 0, 'no account before approval');

  // ---------------------------------------------------------------- 3) الموافقة بأدمن مؤقت aal2
  const adminPhone = newPhone();
  phones.push(adminPhone);
  const adminPin = newPin(adminPhone);
  const ca = await authAdmin('POST', '/admin/users', {
    phone: adminPhone,
    password: adminPin,
    phone_confirm: true,
    user_metadata: { purpose: 'T28 integration test' },
  });
  const caJson = await ca.json();
  if (ca.status !== 200) throw new Error(`create admin: ${ca.status}`);
  const adminId = caJson.id;
  userIds.push(adminId);
  await db.query(
    `update public.profiles set role = 'admin', full_name = 'T28 throwaway admin' where id = $1`,
    [adminId],
  );
  const adminSession = await signIn(adminPhone, adminPin);
  if (adminSession.status !== 200) throw new Error(`admin sign-in: ${adminSession.status}`);
  const adminUser = { key: 'it-t28-admin', access: adminSession.json.access_token };
  const aal1 = await rpc('decide_driver_request', { p_id: id1, p_approve: true }, adminUser.access);
  check(
    aal1.status >= 400 && aal1.json?.message === 'NOT_ALLOWED',
    'admin with PIN only (aal1) cannot decide',
  );
  await upgradeToAal2(http, base, publishableKey, adminUser);
  const approve = await rpc(
    'decide_driver_request',
    { p_id: id1, p_approve: true },
    adminUser.access,
  );
  check(
    approve.status === 200 && approve.json === 'approved',
    `admin aal2 approves (${approve.status})`,
  );
  check((await status(id1, s1)) === 'approved', 'anon status → approved');

  // ---------------------------------------------------------------- 4) الإكمال
  const wrong = await complete({ request_id: id1, device_secret: newSecret(), pin });
  check(
    wrong.status === 404 && wrong.json?.error === 'REQUEST_NOT_FOUND',
    `another device's secret → 404 REQUEST_NOT_FOUND (${brief(wrong)})`,
  );
  const easy = await complete({ request_id: id1, device_secret: s1, pin: '123456' });
  check(
    easy.status === 400 && easy.json?.error === 'PIN_INVALID',
    `easy PIN → 400 PIN_INVALID (${brief(easy)})`,
  );
  check((await userCount(p1)) === 0, 'no account after a wrong secret or an easy PIN');

  const [a, b] = await Promise.all([
    complete({ request_id: id1, device_secret: s1, pin }),
    complete({ request_id: id1, device_secret: s1, pin }),
  ]);
  const codes = [a, b].map((r) => r.status).sort();
  check(
    codes[0] === 201 && codes[1] === 409,
    `two concurrent confirmations → one 201, one 409 (${brief(a)} / ${brief(b)})`,
  );
  check((await userCount(p1)) === 1, 'exactly one account for the phone');

  const session = await signIn(p1, pin);
  check(session.status === 200, 'the new driver signs in with phone + chosen PIN');
  const driverId = session.json?.user?.id;
  if (driverId) userIds.push(driverId);
  const prof = await db.query(
    `select role::text, is_active, must_change_pin, full_name from public.profiles where id = $1`,
    [driverId],
  );
  check(
    prof.rows[0]?.role === 'driver' && prof.rows[0]?.is_active && !prof.rows[0]?.must_change_pin,
    'profile: active driver without must_change_pin',
  );
  const avail = await rpc('available_orders', { p_limit: 5 }, session.json?.access_token);
  check(
    avail.status === 200 && Array.isArray(avail.json),
    `new driver: available_orders → ${avail.status}`,
  );
  check((await status(id1, s1)) === 'completed', 'anon status → completed');

  // ---------------------------------------------------------------- 5) طلب مرفوض
  const p2 = newPhone();
  phones.push(p2);
  const s2 = newSecret();
  const r2 = await register({ full_name: 'IT مرفوض', phone: local(p2), device_secret: s2 });
  const id2 = r2.json?.request_id;
  if (id2) requestIds.push(id2);
  const reject = await rpc(
    'decide_driver_request',
    { p_id: id2, p_approve: false, p_note: 'IT' },
    adminUser.access,
  );
  check(reject.json === 'rejected', 'admin rejects the second request');
  const rejected = await complete({ request_id: id2, device_secret: s2, pin: newPin(p2) });
  check(
    rejected.status === 409 &&
      rejected.json?.error === 'REQUEST_NOT_APPROVED' &&
      (await userCount(p2)) === 0,
    `rejected request → 409 REQUEST_NOT_APPROVED, no account (${brief(rejected)})`,
  );

  // ---------------------------------------------------------------- 6) CORS والأصل
  const pre = await fetch(`${base}/functions/v1/driver-register`, {
    method: 'OPTIONS',
    headers: {
      Origin: WEB_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, apikey, content-type, x-client-info',
    },
  });
  check(
    pre.status === 204 && pre.headers.get('access-control-allow-origin') === WEB_ORIGIN,
    `preflight from ${WEB_ORIGIN} (ALLOWED_ORIGINS) → ${pre.status} with Allow-Origin`,
  );
  const hitsBeforeEvil = ipRow
    ? (
        await db.query(
          `select hits from private.driver_request_rate_limits where bucket = 'ip' and key_hash = $1`,
          [ipRow.key_hash],
        )
      ).rows[0]?.hits
    : null;
  const evil = await register(
    { full_name: 'x', phone: 'x', device_secret: 'x' },
    { Origin: 'https://evil.example' },
  );
  check(
    evil.status === 403 && evil.headers.get('access-control-allow-origin') === null,
    `foreign origin → 403 (${evil.status})`,
  );
  const hitsAfterEvil = ipRow
    ? (
        await db.query(
          `select hits from private.driver_request_rate_limits where bucket = 'ip' and key_hash = $1`,
          [ipRow.key_hash],
        )
      ).rows[0]?.hits
    : null;
  check(
    hitsBeforeEvil === hitsAfterEvil,
    'a foreign origin is refused before any work (not even counted)',
  );

  // ---------------------------------------------------------------- 7) حد الـ IP لا يُتجاوز بترويسات مزوّرة
  if (ipRow) {
    await db.query(
      `update private.driver_request_rate_limits set hits = 10 where bucket = 'ip' and key_hash = $1`,
      [ipRow.key_hash],
    );
    const p3 = newPhone();
    phones.push(p3);
    // (أ) X-Forwarded-For وX-Real-IP تصل للدالة لكنها لا تُقرأ: الحد يبقى على IP المنصة
    const forged = await register(
      { full_name: 'IT مزوّر', phone: local(p3), device_secret: newSecret() },
      { 'x-forwarded-for': '203.0.113.71', 'x-real-ip': '203.0.113.72' },
    );
    check(
      forged.status === 429 && forged.json?.error === 'RATE_LIMITED',
      `IP at its limit + forged X-Forwarded-For / X-Real-IP → still 429 (${brief(forged)})`,
    );
    const forgedComplete = await request(`${base}/functions/v1/driver-complete-registration`, {
      body: { request_id: id1, device_secret: s1, pin },
      headers: { 'x-forwarded-for': '203.0.113.71', 'x-real-ip': '203.0.113.72' },
    });
    check(
      forgedComplete.status === 429 && forgedComplete.json?.error === 'RATE_LIMITED',
      `driver-complete-registration with forged headers → still 429 (${brief(forgedComplete)})`,
    );
    // (ب) cf-connecting-ip مزوّرة: Cloudflare ترفض الطلب عند الحافة (Error 1000) فلا يصل للدالة أصلاً
    const forgedCf = await register(
      { full_name: 'IT مزوّر', phone: local(p3), device_secret: newSecret() },
      { 'cf-connecting-ip': '203.0.113.70' },
    );
    check(
      forgedCf.status === 429 || (forgedCf.status === 403 && typeof forgedCf.json === 'string'),
      `IP at its limit + forged cf-connecting-ip → ${forgedCf.status} ${forgedCf.status === 403 ? '(refused by Cloudflare at the edge)' : ''}, never accepted`,
    );
    const spoofRows = await db.query(
      `select count(*)::int n from private.driver_request_rate_limits where bucket = 'ip' and key_hash = any($1)`,
      [[sha('203.0.113.70'), sha('203.0.113.71'), sha('203.0.113.72'), sha('unknown')]],
    );
    check(spoofRows.rows[0].n === 0, 'no rate-limit key was created for a forged IP');
    const p3req = await db.query(
      `select count(*)::int n from public.driver_requests where phone = $1`,
      [p3],
    );
    check(p3req.rows[0].n === 0, 'the limited request was not stored');
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  failures++;
} finally {
  // التنظيف: الإشعارات والطلبات وسطور التدقيق والحسابات وصفوف الحد (ما أنشأه هذا التشغيل فقط)
  const reqRows = await db.query(`select id from public.driver_requests where phone = any($1)`, [
    phones,
  ]);
  const ids = [...new Set([...requestIds, ...reqRows.rows.map((r) => r.id)])];
  if (ids.length) {
    await db.query(`delete from public.notification_outbox where data ->> 'request_id' = any($1)`, [
      ids,
    ]);
    await db.query(
      `delete from public.admin_audit where action = 'driver_request' and target_id = any($1::uuid[])`,
      [ids],
    );
    await db.query(`delete from public.driver_requests where id = any($1::uuid[])`, [ids]);
  }
  const users = await db.query(`select id from auth.users where phone = any($1)`, [phones]);
  for (const id of new Set([...userIds, ...users.rows.map((r) => r.id)])) {
    const del = await authAdmin('DELETE', `/admin/users/${id}`);
    if (del.status !== 200) console.log(`cleanup: delete user ${id} → ${del.status}`);
  }
  await db.query(
    `delete from private.driver_request_rate_limits where bucket = 'phone' and key_hash = any($1)`,
    [phones.map(sha)],
  );
  if (ipRow) {
    if (ipRow.existed) {
      await db.query(
        `update private.driver_request_rate_limits set hits = $2, window_start = $3 where bucket = 'ip' and key_hash = $1`,
        [ipRow.key_hash, ipRow.hits, ipRow.window_start],
      );
    } else {
      await db.query(
        `delete from private.driver_request_rate_limits where bucket = 'ip' and key_hash = $1`,
        [ipRow.key_hash],
      );
    }
  }
  const leftUsers = await db.query(`select count(*)::int n from auth.users where phone = any($1)`, [
    phones,
  ]);
  const leftReqs = await db.query(
    `select count(*)::int n from public.driver_requests where phone = any($1)`,
    [phones],
  );
  check(
    leftUsers.rows[0].n === 0 && leftReqs.rows[0].n === 0,
    `cleanup: no throwaway account or request left (${phones.length} numbers)`,
  );
  await db.end();
}

console.log(
  failures ? `\n${failures} check(s) failed` : '\nall driver-register integration checks passed',
);
process.exit(failures ? 1 : 0);
