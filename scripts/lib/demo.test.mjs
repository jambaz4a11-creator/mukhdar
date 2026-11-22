// node --test: بيانات دخول العرض (تجهيز الـ repo ليصير عاماً، 2026-11-22). القيم العامة للمحلي فقط،
// وmukhdar-dev يحتاج قيمه من البيئة/.env.local ولا يقبل القيم المنشورة.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOCAL_DEMO_PIN,
  LOCAL_DRIVER_DEMO_PIN,
  LOCAL_TOTP_SECRET,
  demoCredentials,
} from './demo.mjs';

const reader = (vars) => (name) => vars[name];
const LOCAL = { kind: 'local' };
const REMOTE = { kind: 'remote' };
const GOOD = {
  DEMO_PIN: '506183',
  DRIVER_DEMO_PIN: '271946',
  DEMO_TOTP_SECRET: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
};

test('local stack: public local-only values by default', () => {
  assert.deepEqual(demoCredentials(LOCAL, reader({})), {
    pin: LOCAL_DEMO_PIN,
    driverPin: LOCAL_DRIVER_DEMO_PIN,
    totpSecret: LOCAL_TOTP_SECRET,
  });
});

test('local stack: env values win', () => {
  assert.deepEqual(demoCredentials(LOCAL, reader(GOOD)), {
    pin: GOOD.DEMO_PIN,
    driverPin: GOOD.DRIVER_DEMO_PIN,
    totpSecret: GOOD.DEMO_TOTP_SECRET,
  });
});

test('remote: every value is required (no fallback to the public ones)', () => {
  for (const missing of Object.keys(GOOD)) {
    const vars = { ...GOOD, [missing]: undefined };
    assert.throws(() => demoCredentials(REMOTE, reader(vars)), new RegExp(`${missing} is not set`));
  }
  assert.equal(demoCredentials(REMOTE, reader(GOOD)).pin, GOOD.DEMO_PIN);
});

test('remote: the public local values (they are in git) are refused', () => {
  assert.throws(
    () => demoCredentials(REMOTE, reader({ ...GOOD, DEMO_PIN: LOCAL_DEMO_PIN })),
    /DEMO_PIN equals a public/,
  );
  assert.throws(
    () => demoCredentials(REMOTE, reader({ ...GOOD, DRIVER_DEMO_PIN: LOCAL_DRIVER_DEMO_PIN })),
    /DRIVER_DEMO_PIN equals a public/,
  );
  assert.throws(
    () => demoCredentials(REMOTE, reader({ ...GOOD, DEMO_TOTP_SECRET: LOCAL_TOTP_SECRET })),
    /DEMO_TOTP_SECRET equals a public/,
  );
  // تبديل القيمتين العامتين لا يمر أيضاً
  assert.throws(
    () => demoCredentials(REMOTE, reader({ ...GOOD, DEMO_PIN: LOCAL_DRIVER_DEMO_PIN })),
    /DEMO_PIN equals a public/,
  );
});

test('format: 6 digits, not trivial, distinct PINs, 32-char base32 secret', () => {
  for (const DEMO_PIN of ['12345', '1234567', '12a456', '111111', '123456', '654321']) {
    assert.throws(() => demoCredentials(LOCAL, reader({ ...GOOD, DEMO_PIN })), /DEMO_PIN/);
  }
  assert.throws(
    () => demoCredentials(LOCAL, reader({ ...GOOD, DRIVER_DEMO_PIN: GOOD.DEMO_PIN })),
    /must differ/,
  );
  assert.throws(
    () => demoCredentials(LOCAL, reader({ ...GOOD, DEMO_TOTP_SECRET: 'SHORT' })),
    /DEMO_TOTP_SECRET/,
  );
  assert.equal(
    demoCredentials(
      LOCAL,
      reader({ ...GOOD, DEMO_TOTP_SECRET: GOOD.DEMO_TOTP_SECRET.toLowerCase() }),
    ).totpSecret,
    GOOD.DEMO_TOTP_SECRET,
  );
});
