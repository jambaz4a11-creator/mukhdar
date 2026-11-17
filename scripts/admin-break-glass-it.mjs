// اختبار تكامل سكربت الطوارئ على mukhdar-dev فقط: pnpm it:break-glass
//
// ينشئ أدمن مؤقتاً (هاتف بالبادئة 9647007) ويشغّل scripts/admin-break-glass.mjs كعملية فرعية (stdin مُمرَّر):
//   بلا SUPABASE_URL ← يرفض؛ جواب n ← لا تغيير؛ حساب زبون ← يرفض بلا تغيير؛
//   الأدمن ← الرمز القديم يفشل والجديد (المطبوع مرة واحدة) ينجح، رمز التحديث القديم مُبطَل،
//   must_change_pin = true، وسطر pin_resets (kind = break_glass، reset_by فارغ)، وأي طلب RPC مرفوض
//   حتى يغيّر الأدمن رمزه. الرمز لا يُطبع هنا ولا يُحفظ. يحذف كل ما أنشأه حتى عند الفشل.
import { spawn } from 'node:child_process';
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

const target = resolveTarget(['--remote']);
assertSafeTarget(target);
const serviceKey = readEnvLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (.env.local)');
const appEnv = fs.readFileSync(path.join(root, 'apps', 'customer', '.env'), 'utf8');
const publishableKey = /^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.+)$/m.exec(appEnv)?.[1]?.trim();
if (!publishableKey)
  throw new Error('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing (apps/customer/.env)');
const url = `https://${target.projectRef}.supabase.co`;

const db = await connectDev(target);
console.log(`target: ${describe(target)}`);
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok    ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
};

async function request(u, { method = 'POST', key = publishableKey, token, body } = {}) {
  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token ?? key}`,
  };
  const res = await fetch(u, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
const signIn = (phone, pin) =>
  request(`${url}/auth/v1/token?grant_type=password`, {
    body: { phone: `+${phone}`, password: pin },
  });

const newPhone = () => `9647007${String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')}`;
function newPin() {
  for (;;) {
    const pin = Array.from({ length: 6 }, () => crypto.randomInt(0, 10)).join('');
    const d = [...pin].map(Number);
    if (
      ![1, 2, 3].some((p) => d.every((x, i) => x === d[i % p])) &&
      ![1, -1].some((s) => d.every((x, i) => i === 0 || x - d[i - 1] === s))
    )
      return pin;
  }
}

const created = [];
async function createUser(phone, pin, role) {
  const r = await request(`${url}/auth/v1/admin/users`, {
    key: serviceKey,
    body: {
      phone,
      password: pin,
      phone_confirm: true,
      user_metadata: { purpose: 'break-glass integration test' },
    },
  });
  if (r.status !== 200) throw new Error(`createUser: ${r.status}`);
  created.push(r.json.id);
  await db.query(`update public.profiles set role = $2, full_name = $3 where id = $1`, [
    r.json.id,
    role,
    `break-glass throwaway ${role}`,
  ]);
  return r.json.id;
}

/** يشغّل السكربت بالمدخلات المعطاة؛ يرجع الخرج بلا الرمز + الرمز المستخرج (إن ظهر) + رمز الخروج. */
function runScript(phoneArg, answers, env, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'scripts', 'admin-break-glass.mjs'), phoneArg, ...extra],
      {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.stdin.end(answers);
    child.on('close', (code) => {
      const pin = /PIN: (\d{6})/.exec(out)?.[1] ?? null;
      resolve({ code, pin, out: out.replace(/PIN: \d{6}/g, 'PIN: ******') });
    });
  });
}

// الاختبار يمرّر stdin بأنبوب، فيحتاج الاستثناء الصريح (مشروع التطوير فقط)؛ وCI يُزال من بيئة السكربت الفرعي
// (حالة CI نفسها مُختبَرة أدناه وبـ scripts/lib/breakGlass.test.mjs).
const baseEnv = {
  ...process.env,
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  MUKHDAR_BREAK_GLASS_TEST: '1',
};
delete baseEnv.CI;

try {
  const adminPhone = newPhone();
  const oldPin = newPin();
  const adminId = await createUser(adminPhone, oldPin, 'admin');
  const custPhone = newPhone();
  const custPin = newPin();
  await createUser(custPhone, custPin, 'customer');
  const oldSession = await signIn(adminPhone, oldPin);
  check(oldSession.status === 200, 'throwaway admin signs in with the old PIN');

  // لا URL ← يرفض (بلا SUPABASE_URL ببيئة العملية ولا بملف البيئة)
  const noUrlEnv = { ...baseEnv };
  delete noUrlEnv.SUPABASE_URL;
  const noUrl = await runScript(`+${adminPhone}`, 'y\n', {
    ...noUrlEnv,
    MUKHDAR_ENV_FILE: path.join(root, 'does-not-exist.env'),
  });
  check(
    noUrl.code !== 0 && /SUPABASE_URL is missing/.test(noUrl.out) && !noUrl.pin,
    'refuses without SUPABASE_URL',
  );
  check(
    (await signIn(adminPhone, oldPin)).status === 200,
    'refusal changed nothing (old PIN still works)',
  );

  // M4: بلا استثناء الاختبار، stdin المُمرَّر (echo y |) مرفوض ولا يتغير شيء؛ ومع CI مرفوض حتى بالاستثناء
  const piped = { ...baseEnv };
  delete piped.MUKHDAR_BREAK_GLASS_TEST;
  const pipedRun = await runScript(`+${adminPhone}`, 'y\n\n', piped);
  check(
    pipedRun.code !== 0 && /real terminal/.test(pipedRun.out) && !pipedRun.pin,
    'refuses piped stdin/stdout (no scripted confirmation, no PIN in a captured log)',
  );
  const inCi = await runScript(`+${adminPhone}`, 'y\n\n', { ...baseEnv, CI: 'true' });
  check(
    inCi.code !== 0 && /CI is set/.test(inCi.out) && !inCi.pin,
    'refuses when CI is set, even with the test escape',
  );
  check(
    (await signIn(adminPhone, oldPin)).status === 200,
    'terminal refusals changed nothing (old PIN still works)',
  );

  // رقم غير صالح
  const badPhone = await runScript('12345', '', baseEnv);
  check(badPhone.code !== 0 && /usage/.test(badPhone.out), 'refuses a malformed phone');

  // جواب n ← لا تغيير؛ والمشروع المستهدف مطبوع
  const declined = await runScript(`0${adminPhone.slice(3)}`, 'n\n', baseEnv);
  check(
    declined.code !== 0 && /cancelled/.test(declined.out) && !declined.pin,
    'answer "n" cancels',
  );
  check(
    new RegExp(target.projectRef).test(declined.out) && /mukhdar-dev/.test(declined.out),
    'prints the target project before asking',
  );
  check(
    (await signIn(adminPhone, oldPin)).status === 200,
    'cancel changed nothing (old PIN still works)',
  );

  // حساب غير أدمن ← يرفض بلا تغيير
  const asCustomer = await runScript(`+${custPhone}`, 'y\n', baseEnv);
  check(
    asCustomer.code !== 0 && /not an admin/.test(asCustomer.out) && !asCustomer.pin,
    'refuses a non-admin account',
  );
  check((await signIn(custPhone, custPin)).status === 200, 'the customer PIN is untouched');

  // الأدمن: نجاح
  const ok = await runScript(`+${adminPhone}`, 'y\n\n', baseEnv);
  check(ok.code === 0 && ok.pin !== null, 'admin: reset succeeds and prints a 6-digit PIN once');
  check(ok.out.split('PIN: ******').length === 2, 'the PIN is printed exactly once');
  check((await signIn(adminPhone, oldPin)).status !== 200, 'old PIN no longer signs in');
  const fresh = await signIn(adminPhone, ok.pin ?? '000000');
  check(fresh.status === 200, 'the new PIN signs in');
  const refresh = await request(`${url}/auth/v1/token?grant_type=refresh_token`, {
    body: { refresh_token: oldSession.json?.refresh_token },
  });
  check(refresh.status !== 200, 'the old session (refresh token) is revoked');

  const flag = await db.query(`select must_change_pin from public.profiles where id = $1`, [
    adminId,
  ]);
  check(flag.rows[0]?.must_change_pin === true, 'must_change_pin is set');
  const audit = await db.query(`select kind, reset_by from public.pin_resets where user_id = $1`, [
    adminId,
  ]);
  check(
    audit.rows.length === 1 &&
      audit.rows[0].kind === 'break_glass' &&
      audit.rows[0].reset_by === null,
    'one pin_resets row: kind = break_glass, no reset_by',
  );
  const blocked = await request(`${url}/rest/v1/rpc/stuck_notifications_count`, {
    token: fresh.json?.access_token,
    body: {},
  });
  check(
    blocked.status !== 200,
    `flagged admin: RPCs are refused until the PIN is changed (${blocked.status})`,
  );
  const change = await request(`${url}/auth/v1/user`, {
    method: 'PUT',
    token: fresh.json?.access_token,
    body: { password: newPin() },
  });
  check(change.status === 200, `the admin changes the PIN (${change.status})`);
  const cleared = await db.query(`select must_change_pin from public.profiles where id = $1`, [
    adminId,
  ]);
  check(cleared.rows[0]?.must_change_pin === false, 'after the change the flag is cleared');

  // ---------------------------------------------------------------- T23 C1: --mfa-only
  await db.query(
    `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
     values (gen_random_uuid(), $1, 'it break-glass', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP')`,
    [adminId],
  );
  const mfa = await runScript(`+${adminPhone}`, 'y\n', baseEnv, ['--mfa-only']);
  check(
    mfa.code === 0 && !mfa.pin && /2FA factors removed/.test(mfa.out),
    '--mfa-only: succeeds without printing a PIN',
  );
  const factors = await db.query(
    `select count(*)::int n from auth.mfa_factors where user_id = $1`,
    [adminId],
  );
  check(factors.rows[0].n === 0, '--mfa-only: the TOTP factor is removed');
  const mfaAudit = await db.query(
    `select actor, after ->> 'via' via from public.admin_audit where target_id = $1 and action = 'mfa_reset'`,
    [adminId],
  );
  check(
    mfaAudit.rows.length === 1 &&
      mfaAudit.rows[0].actor === null &&
      mfaAudit.rows[0].via === 'break_glass',
    '--mfa-only: one admin_audit row (mfa_reset, via break_glass, no actor)',
  );
} catch (err) {
  console.error(`error: ${err.message}`);
  failures++;
} finally {
  for (const id of created) {
    await db.query(`delete from public.pin_resets where user_id = $1`, [id]);
    await db.query(`delete from public.admin_audit where target_id = $1`, [id]);
    const del = await request(`${url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      key: serviceKey,
    });
    if (del.status !== 200) console.log(`cleanup: delete ${id} → ${del.status}`);
  }
  const left = await db.query(`select count(*)::int n from auth.users where id = any ($1)`, [
    created,
  ]);
  check(left.rows[0].n === 0, `cleanup: no throwaway user left (${created.length})`);
  await db.end();
}

console.log(
  failures ? `\n${failures} check(s) failed` : '\nall break-glass integration checks passed',
);
process.exit(failures ? 1 : 0);
