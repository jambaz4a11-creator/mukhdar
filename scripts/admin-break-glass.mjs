#!/usr/bin/env node
// طوارئ: إعادة ضبط رمز أدمن نسيه (مراجعة T16-T19 M4، RUNBOOK §7).
//
//   pnpm admin:break-glass-reset 07XXXXXXXXX
//
// يعمل على جهاز صاحب المشروع فقط (مفتاح service_role من .env.local، لا يُنسخ لمكان آخر ولا يُرفع):
//   1) يرفض العمل إن غاب SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY (بيئة العملية أو .env.local).
//   2) يطبع المشروع المستهدف ويسأل y/N؛ مشروع غير التطوير المعروف يتطلب كتابة معرّفه كاملاً.
//   3) يقبل حساب أدمن فقط (لا زبون ولا موظف ولا سائق: لهم "إعادة ضبط رمز الدخول" بلوحة الأدمن).
//   4) يولّد رمزاً عشوائياً من 6 أرقام، ويضبطه (auth.admin)، ثم يُبطل كل جلسات الحساب (revoke_user_sessions)،
//      ثم يسجّل pin_resets (kind = 'break_glass'، reset_by فارغ) ويضبط must_change_pin (record_pin_reset):
//      أول دخول يُجبر على تغيير الرمز.
//   5) الرمز يظهر مرة واحدة على الشاشة فقط، ثم يُمسح عند الضغط على Enter. لا يُكتب بملف ولا بسجل ولا
//      بسطر أوامر ولا بـ SQL. أي فشل بعد تغيير الرمز يطبع الخطوة الفاشلة بلا الرمز: أعد التشغيل (آمن).
// تُسلَّم النتيجة للأدمن بمكالمة هاتفية، لا واتساب ولا رسالة.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DEV_PROJECT_REF, projectRef, randomPin, storedPhone } from './lib/breakGlass.mjs';

const root = path.resolve(import.meta.dirname, '..');
function readEnv(name) {
  if (process.env[name]) return process.env[name].trim();
  // MUKHDAR_ENV_FILE: للاختبار فقط (ملف بيئة بديل)؛ الافتراضي .env.local بجذر المشروع
  const file = process.env.MUKHDAR_ENV_FILE ?? path.join(root, '.env.local');
  if (!fs.existsSync(file)) return undefined;
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

function fail(message) {
  console.error(`\nخطأ: ${message}`);
  process.exit(1);
}

async function main() {
  const phone = storedPhone(process.argv[2]);
  if (!phone) {
    fail('usage: pnpm admin:break-glass-reset 07XXXXXXXXX   (the admin phone number)');
  }
  const url = readEnv('SUPABASE_URL')?.replace(/\/+$/, '');
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url) fail('SUPABASE_URL is missing (env or .env.local). Refusing to guess the project.');
  if (!serviceKey)
    fail('SUPABASE_SERVICE_ROLE_KEY is missing (env or .env.local). Refusing to run.');
  const ref = projectRef(url);
  if (!ref) fail(`SUPABASE_URL is not a https://<ref>.supabase.co URL: ${url}`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => {
    process.stdout.write(q);
    const { value, done } = await lines.next();
    return done ? '' : String(value).trim();
  };

  const isDev = ref === DEV_PROJECT_REF;
  console.log(
    `Project : ${ref} ${isDev ? '(mukhdar-dev, development)' : '(NOT the known development project: production?)'}`,
  );
  console.log(`URL     : ${url}`);
  console.log(`Account : +${phone}`);
  if (!isDev) {
    const typed = await ask(`Type the project ref (${ref}) to continue: `);
    if (typed !== ref) fail('project ref not confirmed. Nothing changed.');
  }
  const yes = (await ask('Reset the PIN of this ADMIN account? [y/N] ')).toLowerCase();
  if (yes !== 'y' && yes !== 'yes') fail('cancelled. Nothing changed.');

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const call = async (method, pathname, body) => {
    const res = await fetch(`${url}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };

  // الحساب: أدمن فقط
  const lookup = await call('GET', `/rest/v1/profiles?phone=eq.${phone}&select=id,role,is_active`);
  if (lookup.status !== 200)
    fail(`profile lookup failed (HTTP ${lookup.status}). Nothing changed.`);
  const profile = lookup.json?.[0];
  if (!profile) fail('no account with this phone. Nothing changed.');
  if (profile.role !== 'admin') {
    fail(
      `this account is a ${profile.role}, not an admin. Break-glass is for admin accounts only ` +
        '(others: "إعادة ضبط رمز الدخول" in the admin panel). Nothing changed.',
    );
  }
  if (!profile.is_active) {
    console.log(
      'تنبيه: the account is DEACTIVATED; the new PIN will not work until it is reactivated.',
    );
  }

  const pin = randomPin(phone);

  // الرمز ← الجلسات ← التدقيق (record_pin_reset يضبط must_change_pin بعد أن يمسحه تغيير كلمة السر)
  const steps = [
    ['set the PIN', () => call('PUT', `/auth/v1/admin/users/${profile.id}`, { password: pin })],
    [
      'revoke all sessions',
      () => call('POST', '/rest/v1/rpc/revoke_user_sessions', { p_user_id: profile.id }),
    ],
    [
      'write the audit row + must_change_pin',
      () =>
        call('POST', '/rest/v1/rpc/record_pin_reset', {
          p_user_id: profile.id,
          p_reset_by: null,
          p_kind: 'break_glass',
        }),
    ],
  ];
  for (const [label, run] of steps) {
    const res = await run();
    if (res.status >= 300) {
      fail(
        `step "${label}" failed (HTTP ${res.status}). The PIN is NOT shown; run the command again ` +
          '(re-running is safe: it sets a new PIN).',
      );
    }
  }

  console.log(
    '\nDone: sessions revoked, audit row written, the admin must change the PIN at first sign-in.',
  );
  console.log('Tell the admin by PHONE CALL (not WhatsApp, not a message). Shown once:\n');
  console.log(`    PIN: ${pin}\n`);
  await ask('Press Enter to clear the PIN from the screen… ');
  // امسح السطور الأربعة الأخيرة (سطر Enter + فراغ + PIN + فراغ) من الطرفية
  if (process.stdout.isTTY) process.stdout.write('\x1b[4A\x1b[0J');
  console.log('PIN cleared from the screen.');
  rl.close();
}

await main();
