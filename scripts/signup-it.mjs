// اختبار تكامل Edge Function signup على mukhdar-dev فقط: pnpm it:signup
//
//   pnpm it:signup                       -> الدالة المنشورة: إنشاء حساب ثم الدخول به من "التطبيق"
//                                          (المفتاح المنشور)، رقم مسجل، قواعد الـ PIN بالخادم، رقم غير
//                                          صالح، حد المعدل لكل رقم، وترويسات IP مزوّرة لا تُستعمل.
//   pnpm it:signup -- --signup-disabled  -> بعد إطفاء "Allow new users to sign up" باللوحة: التسجيل العام
//                                          (signUp) وطلب OTP لرقم جديد لا ينشئان حساباً، والدالة تعمل.
//
// كل الأرقام بالبادئة 9647006 (ليست لأي شركة). يحذف كل حساب أنشأه وصفوف حدود المعدل التي بدأت أثناءه،
// حتى عند الفشل. لا يطبع الـ PIN ولا المفاتيح.
// يحتاج: .env.local (SUPABASE_DB_PASSWORD، SUPABASE_SERVICE_ROLE_KEY)، apps/customer/.env (المفتاح المنشور).
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

const signupDisabledMode = process.argv.includes('--signup-disabled');
const target = resolveTarget(['--remote']);
assertSafeTarget(target);
const serviceKey = readEnvLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (.env.local)');
const appEnv = fs.readFileSync(path.join(root, 'apps', 'customer', '.env'), 'utf8');
const publishableKey = /^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.+)$/m.exec(appEnv)?.[1]?.trim();
if (!publishableKey)
  throw new Error('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing (apps/customer/.env)');

const base = `https://${target.projectRef}.supabase.co`;
const db = await connectDev(target);
console.log(`target: ${describe(target)}${signupDisabledMode ? ' (--signup-disabled)' : ''}`);

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok    ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
};

async function request(url, { headers = {}, body, key = publishableKey } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** مثل التطبيق: supabase.functions.invoke('signup', { body }) بالمفتاح المنشور. */
const signup = (body, headers) => request(`${base}/functions/v1/signup`, { body, headers });
const signIn = (phone, password) =>
  request(`${base}/auth/v1/token?grant_type=password`, { body: { phone: `+${phone}`, password } });
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const userCount = async (phone) =>
  (await db.query('select count(*)::int as n from auth.users where phone = $1', [phone])).rows[0].n;

const newPhone = () => `9647006${String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')}`;
const local = (phone) => `0${phone.slice(3)}`; // 9647006xxxxxx -> 07006xxxxxx
const PIN = '583914'; // مستخدمون مؤقتون يُحذفون بنهاية الفحص؛ ليس رمز حساب حقيقي
const phones = [];
const started = (await db.query('select now() as t')).rows[0].t;

try {
  if (!signupDisabledMode) {
    // 1) إنشاء حساب ثم الدخول به
    const p1 = newPhone();
    phones.push(p1);
    const created = await signup({ phone: local(p1), pin: PIN });
    check(
      created.status === 201 && created.json?.created === true,
      `signup ${local(p1)} → 201 {created: true}`,
    );
    const prof = await db.query(
      `select u.phone, u.phone_confirmed_at is not null as confirmed, p.role, p.phone as profile_phone
         from auth.users u join public.profiles p on p.id = u.id where u.phone = $1`,
      [p1],
    );
    const row = prof.rows[0];
    check(
      row?.confirmed && row.role === 'customer' && row.profile_phone === p1,
      'auth.users phone confirmed; profiles: role customer, phone 9647…',
    );
    const session = await signIn(p1, PIN);
    check(
      session.status === 200 && typeof session.json?.access_token === 'string',
      'app signs in with phone + PIN → session',
    );
    const wrong = await signIn(p1, '583915');
    check(
      wrong.status === 400 && wrong.json?.error_code === 'invalid_credentials',
      'wrong PIN → invalid_credentials',
    );

    // 2) رقم مسجل
    const again = await signup({ phone: `+${p1}`, pin: '730268' });
    check(
      again.status === 409 && again.json?.error === 'PHONE_TAKEN',
      'same number again → 409 PHONE_TAKEN',
    );
    check((await userCount(p1)) === 1, 'still exactly one account for the number');

    // 3) قواعد الـ PIN والرقم بالخادم
    const p2 = newPhone();
    phones.push(p2);
    const trivial = await signup({ phone: local(p2), pin: '123456' });
    check(
      trivial.status === 400 && trivial.json?.error === 'PIN_INVALID',
      'easy PIN 123456 → 400 PIN_INVALID',
    );
    const fromPhone = await signup({ phone: local(p2), pin: p2.slice(-6) });
    check(
      fromPhone.status === 400 && fromPhone.json?.error === 'PIN_INVALID',
      'PIN = last 6 digits of the phone → PIN_INVALID',
    );
    check((await userCount(p2)) === 0, 'no account created for rejected PINs');
    const badPhone = await signup({ phone: '0612345678', pin: PIN });
    check(
      badPhone.status === 400 && badPhone.json?.error === 'PHONE_INVALID',
      'non-mobile number → 400 PHONE_INVALID',
    );

    // 4) ترويسات IP مزوّرة من العميل لا تُستعمل كمفتاح
    const spoofed = ['203.0.113.77', '203.0.113.78', '203.0.113.79'];
    await signup(
      { phone: 'x', pin: 'x' },
      { 'x-forwarded-for': spoofed[0], 'cf-connecting-ip': spoofed[1], 'x-real-ip': spoofed[2] },
    );
    const keys = await db.query(
      `select key_hash from private.signup_rate_limits where bucket = 'ip' and key_hash = any($1)`,
      [[...spoofed, 'unknown'].map(sha)],
    );
    check(
      keys.rowCount === 0,
      'client-supplied X-Forwarded-For / CF-Connecting-IP / X-Real-IP are not trusted; IP is known',
    );

    // 5) حد المعدل لكل رقم: 5 بالساعة
    const p3 = newPhone();
    phones.push(p3);
    const statuses = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await signup({ phone: local(p3), pin: '111111' })).status);
    check(
      JSON.stringify(statuses) === JSON.stringify([400, 400, 400, 400, 400, 429]),
      `6 attempts for one number → 5×400 then 429 RATE_LIMITED (${statuses.join(',')})`,
    );
    const stored = await db.query(
      `select hits from private.signup_rate_limits where bucket = 'phone' and key_hash = $1`,
      [sha(p3)],
    );
    check(stored.rows[0]?.hits === 6, 'counter stored as a sha256 key (no raw phone)');
  } else {
    // بعد إطفاء "Allow new users to sign up": GoTrue يرفض إنشاء الحساب العام بأي طريق
    const p4 = newPhone();
    phones.push(p4);
    const pub = await request(`${base}/auth/v1/signup`, {
      body: { phone: `+${p4}`, password: PIN },
    });
    check(pub.status >= 400, `public signUp → ${pub.status} ${pub.json?.error_code ?? ''}`);
    const otp = await request(`${base}/auth/v1/otp`, {
      body: { phone: `+${p4}`, create_user: true },
    });
    check(
      otp.status >= 400,
      `signInWithOtp (new number) → ${otp.status} ${otp.json?.error_code ?? ''}`,
    );
    check((await userCount(p4)) === 0, 'neither created an account (the OTP hole is closed)');

    const p5 = newPhone();
    phones.push(p5);
    const created = await signup({ phone: local(p5), pin: PIN });
    check(created.status === 201, 'Edge Function signup still creates accounts (Admin API)');
    const session = await signIn(p5, PIN);
    check(session.status === 200, 'and the new account signs in with phone + PIN');
  }
} finally {
  // تنظيف: الحسابات المؤقتة عبر Admin API (يمتد لـ profiles)، وصفوف الحدود التي بدأت أثناء الفحص
  const ids = await db.query('select id from auth.users where phone = any($1)', [phones]);
  for (const { id } of ids.rows) {
    const res = await fetch(`${base}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) console.log(`cleanup: delete user ${id} → ${res.status}`);
  }
  await db.query('delete from private.signup_rate_limits where window_start >= $1', [started]);
  const left = await db.query('select count(*)::int as n from auth.users where phone = any($1)', [
    phones,
  ]);
  check(left.rows[0].n === 0, `cleanup: ${ids.rowCount} test account(s) deleted, none left`);
  await db.end();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
