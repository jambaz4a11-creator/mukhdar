#!/usr/bin/env node
// تدوير بيانات دخول العرض (تجهيز الـ repo ليصير عاماً، 2026-11-22). للتطوير فقط: نفس حماية seed:demo.
//
//   pnpm demo:rotate              -> المحلي (القيم المحلية العامة)
//   pnpm demo:rotate -- --remote  -> mukhdar-dev (DEMO_PIN وDRIVER_DEMO_PIN وDEMO_TOTP_SECRET من .env.local)
//
// يكتب على حسابات العرض الموجودة (بادئة 9647000) والحمل (9647001) فقط:
//   - رمز الدخول: DRIVER_DEMO_PIN للسائقين التجريبيين 07000000011..13، وDEMO_PIN لكل الباقي.
//   - سر عامل TOTP المُفعَّل لكل حساب عرض له عامل (الأدمن والموظف) ← DEMO_TOTP_SECRET.
//   - يحذف جلسات هذه الحسابات (refresh tokens تُحذف معها)، فالقيم القديمة المنشورة لا تبقي أحداً داخلاً.
// لا يغيّر الأدوار ولا البيانات ولا must_change_pin. لا يطبع القيم.
import { assertSafeTarget, connectDev, describe, readEnvLocal, resolveTarget } from './lib/db.mjs';
import { DEMO_PHONE_LIKE, DEMO_PHONE_PREFIX, demoCredentials, phone } from './lib/demo.mjs';

const target = resolveTarget();
assertSafeTarget(target);
const { pin, driverPin, totpSecret } = demoCredentials(target, readEnvLocal);
const DEMO_DRIVERS = [11, 12, 13].map((n) => phone(DEMO_PHONE_PREFIX, n));

const client = await connectDev(target);
console.log(`rotating demo credentials on ${describe(target)}`);
try {
  await client.query('begin');
  await client.query(
    `create temp table demo_users on commit drop as
       select id, phone from auth.users where phone like any ($1::text[])`,
    [DEMO_PHONE_LIKE],
  );
  const pins = await client.query(
    // bcrypt مرة لكل رمز (لا لكل صف: حسابات الحمل ألف)، كما يفعل seed:demo
    `with h as (
       select extensions.crypt($1::text, extensions.gen_salt('bf', 10)) as demo,
              extensions.crypt($3::text, extensions.gen_salt('bf', 10)) as driver
     )
     update auth.users u
        set encrypted_password = case when u.phone = any ($2::text[]) then h.driver else h.demo end,
            updated_at = now()
       from demo_users d, h where d.id = u.id`,
    [pin, DEMO_DRIVERS, driverPin],
  );
  const factors = await client.query(
    `update auth.mfa_factors f set secret = $1, updated_at = now()
      where f.factor_type = 'totp' and f.status = 'verified' and f.user_id in (select id from demo_users)`,
    [totpSecret],
  );
  const sessions = await client.query(
    `delete from auth.sessions where user_id in (select id from demo_users)`,
  );
  await client.query('commit');
  console.log(
    `done: ${pins.rowCount} demo PINs, ${factors.rowCount} TOTP factors, ${sessions.rowCount} sessions revoked`,
  );
} catch (err) {
  await client.query('rollback').catch(() => {});
  throw err;
} finally {
  await client.end();
}
