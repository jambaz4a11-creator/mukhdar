// node --test: TOTP مقابل متجهات RFC 6238 (الملحق B، SHA1).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEV_TOTP_SECRET,
  base32Decode,
  base32Encode,
  hotp,
  randomTotpSecret,
  totp,
} from './totp.mjs';

const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET = base32Encode(RFC_KEY);

test('RFC 6238 SHA1 vectors (8 digits)', () => {
  for (const [t, code] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ]) {
    assert.equal(totp(RFC_SECRET, t * 1000, { digits: 8 }), code, `T=${t}`);
  }
});

test('RFC 4226 HOTP vectors (6 digits)', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676'];
  expected.forEach((code, i) => assert.equal(hotp(RFC_KEY, i), code));
});

test('base32 round trip, the dev secret decodes to 160 bits', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(RFC_SECRET), RFC_KEY);
  assert.equal(base32Decode(DEV_TOTP_SECRET).length, 20);
  assert.throws(() => base32Decode('A1'), /invalid base32/);
  const r = randomTotpSecret();
  assert.match(r, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(r).length, 20);
});

test('6-digit codes change every 30 s', () => {
  assert.match(totp(DEV_TOTP_SECRET), /^\d{6}$/);
  assert.equal(totp(DEV_TOTP_SECRET, 30_000), totp(DEV_TOTP_SECRET, 59_999));
  assert.notEqual(totp(DEV_TOTP_SECRET, 30_000), totp(DEV_TOTP_SECRET, 60_000));
});
