// مولّد TOTP الذي تستعمله e2e (T23 C1) مقابل متجهات RFC 6238 (SHA1) ومتطابق مع scripts/lib/totp.mjs.
import { describe, expect, it } from 'vitest';
import { DEV_TOTP_SECRET, base32Decode, totp } from '../../e2e/totp';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"

describe('e2e TOTP', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [20000000000, '65353130'],
  ])('RFC 6238 vector T=%i', (t, code) => {
    expect(totp(RFC_SECRET, t * 1000, 8)).toBe(code);
  });

  it('the dev secret is a valid 160-bit base32 key and gives 6 digits', () => {
    expect(base32Decode(DEV_TOTP_SECRET)).toHaveLength(20);
    expect(totp(DEV_TOTP_SECRET)).toMatch(/^\d{6}$/);
  });
});
