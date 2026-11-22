// TOTP (RFC 6238: SHA1، 6 أرقام، 30 ثانية) لاختبارات e2e (T23 C1). نسخة TS من scripts/lib/totp.mjs.
// حسابا العرض (أدمن وموظف) لهما عامل بالسر التجريبي (seed:demo)؛ dev والمكدس المحلي فقط، أبداً الإنتاج.
import { createHmac } from 'node:crypto';
import { demoEnv } from './demoEnv';

// الافتراضي = السر العام للمكدس المحلي فقط (CI)؛ ضد mukhdar-dev: E2E_TOTP_SECRET أو DEMO_TOTP_SECRET (RUNBOOK §6).
export const DEV_TOTP_SECRET =
  demoEnv('E2E_TOTP_SECRET', 'DEMO_TOTP_SECRET') ?? 'MUKHDARDEVONLYTOTPSECRETNOTPROD2';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, timeMs = Date.now(), digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}

/** رمز لا ينتهي خلال الثواني القليلة القادمة (ينتظر النافذة التالية إن لزم). */
export async function freshTotp(secret: string, minLeftSec = 4): Promise<string> {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < minLeftSec) await new Promise((r) => setTimeout(r, left * 1000 + 250));
  return totp(secret);
}
