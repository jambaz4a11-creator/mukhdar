// سر الجهاز (SPEC-driver §2.3، §3): 32 بايت من مولّد عشوائي آمن (expo-crypto ← SecRandomCopyBytes /
// SecureRandom)، بترميز base64url بلا حشو = 43 حرفاً. يُحفظ بـ SecureStore **قبل** إرسال الطلب.
// لا يُطبع أبداً. الخادم يخزّن SHA-256 له فقط.
import * as Crypto from 'expo-crypto';
import { readSecret, saveSecret } from '../../lib/secureStore';

export const DEVICE_SECRET_BYTES = 32;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url بلا "=" (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
    if (b1 !== undefined) out += ALPHABET.charAt((n >> 6) & 63);
    if (b2 !== undefined) out += ALPHABET.charAt(n & 63);
  }
  return out;
}

export async function generateDeviceSecret(
  randomBytes: (n: number) => Promise<Uint8Array> = Crypto.getRandomBytesAsync,
): Promise<string> {
  const bytes = await randomBytes(DEVICE_SECRET_BYTES);
  if (bytes.length !== DEVICE_SECRET_BYTES) throw new Error('device secret: short random source');
  return toBase64Url(bytes);
}

/**
 * السر المحفوظ إن وُجد (محاولة سابقة انقطعت قبل وصول request_id: إعادة الإرسال بنفس السر ترجع نفس الطلب)،
 * وإلا سر جديد يُحفظ ثم يُرجع.
 */
export async function getOrCreateDeviceSecret(): Promise<string> {
  const existing = await readSecret();
  if (existing) return existing;
  const secret = await generateDeviceSecret();
  await saveSecret(secret);
  return secret;
}
