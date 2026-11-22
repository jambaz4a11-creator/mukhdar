// TOTP (RFC 6238: HMAC-SHA1، 6 أرقام، خطوة 30 ثانية) للسكربتات وبيئة التطوير فقط (T23 C1).
// - seed:demo يسجّل لحسابي العرض (أدمن وموظف) عاملاً مُفعَّلاً بسر **تجريبي ثابت** معروف، حتى تدخل e2e
//   واختبارات التكامل بـ aal2 على المكدس المحلي وmukhdar-dev. لا يُستعمل أبداً على الإنتاج: seed:demo يرفض
//   أي مشروع غير dev (scripts/lib/db.mjs).
// - السكربتات التي تنشئ أدمن/موظف مؤقت (الحمل، اختبارات التكامل) تسجّل عاملاً بسر عشوائي وتولّد الرمز هنا.
import { createHmac, randomBytes } from 'node:crypto';

// سر حسابات العرض: demoCredentials بـ scripts/lib/demo.mjs (المحلي عام، mukhdar-dev من .env.local).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
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

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** سر عشوائي (160 بت) لعامل مؤقت. */
export function randomTotpSecret() {
  return base32Encode(randomBytes(20));
}

/** HOTP/TOTP بمفتاح خام (Buffer). digits 6 افتراضاً (8 لمتجهات RFC). */
export function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}

/** رمز TOTP الحالي (أو لوقت محدد بالمللي ثانية) لسر base32. */
export function totp(secretBase32, timeMs = Date.now(), { step = 30, digits = 6 } = {}) {
  return hotp(base32Decode(secretBase32), Math.floor(timeMs / 1000 / step), digits);
}

/**
 * ينتظر حتى لا يكون الرمز قريباً من نهاية نافذته (أقل من minLeft ثانية)، فلا يصل للخادم منتهياً.
 * يرجع الرمز.
 */
export async function freshTotp(secretBase32, minLeft = 3) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < minLeft) await new Promise((r) => setTimeout(r, left * 1000 + 200));
  return totp(secretBase32);
}
