// تشفير Web Push بـ WebCrypto فقط (بلا اعتماديات): RFC 8291 (aes128gcm، RFC 8188) وVAPID (RFC 8292).
// قرار T35 (SPEC-webpush §5.4): تنفيذ داخلي بدل npm:web-push؛ يطابق متجهات RFC 8291 حرفياً (webpush_crypto_test.ts).
// لا يُسجَّل شيء هنا، ورسائل الأخطاء لا تحوي أي مفتاح.

export const RECORD_SIZE = 4096;
const KEY_BYTES = 65; // P-256 غير مضغوط: 0x04 || x || y
const enc = new TextEncoder();

// ---------------------------------------------------------------- base64url
export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('invalid base64url');
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function decodeKey(value: string, bytes: number, what: string): Uint8Array<ArrayBuffer> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = b64urlDecode(value);
  } catch {
    throw new Error(`invalid ${what}`);
  }
  if (raw.length !== bytes) throw new Error(`invalid ${what}`);
  if (bytes === KEY_BYTES && raw[0] !== 0x04) throw new Error(`invalid ${what}`);
  return raw;
}

/** JWK خاص من d (32 بايت) والمفتاح العام الخام. */
function privateJwk(d: string, publicRaw: Uint8Array): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    d,
    x: b64urlEncode(publicRaw.subarray(1, 33)),
    y: b64urlEncode(publicRaw.subarray(33, 65)),
    ext: false,
  };
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', concat(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(salt), info: concat(info) },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------- RFC 8291
export interface EncryptOptions {
  /** للاختبار فقط (متجهات RFC): مفتاح الخادم المؤقت والملح. افتراضياً: جديدان لكل رسالة. */
  serverKeys?: { publicKey: string; privateKey: string };
  salt?: Uint8Array;
}

/**
 * يشفّر الحمولة لاشتراك واحد ويرجع جسم الطلب: header (salt 16 || rs 4 || idlen 1 || as_public 65) || ciphertext.
 * سجل واحد (الحمولة أصغر من rs)، بلا حشو، الفاصل 0x02 (آخر سجل).
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublicRaw = decodeKey(p256dh, KEY_BYTES, 'subscription key p256dh');
  const authSecret = decodeKey(auth, 16, 'subscription key auth');
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error('payload too large');

  const uaPublic = await crypto.subtle
    .importKey('raw', uaPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    .catch(() => {
      throw new Error('invalid subscription key p256dh');
    });

  let asPrivate: CryptoKey;
  let asPublicRaw: Uint8Array<ArrayBuffer>;
  if (options.serverKeys) {
    asPublicRaw = decodeKey(options.serverKeys.publicKey, KEY_BYTES, 'server public key');
    asPrivate = await crypto.subtle.importKey(
      'jwk',
      privateJwk(options.serverKeys.privateKey, asPublicRaw),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
      'deriveBits',
    ])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  const salt = options.salt ? concat(options.salt) : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error('invalid salt');

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublic }, asPrivate, 256),
  );
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, record),
  );

  const header = new Uint8Array(16 + 4 + 1 + KEY_BYTES);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = KEY_BYTES;
  header.set(asPublicRaw, 21);
  return concat(header, ciphertext);
}

// ---------------------------------------------------------------- VAPID (RFC 8292)
export interface VapidKeys {
  publicKey: string;
  signingKey: CryptoKey;
}

/** يستورد زوج VAPID (base64url: عام خام 65 بايت، خاص d 32 بايت) ويتحقق أنهما زوج واحد. */
export async function importVapidKeys(publicKey: string, privateKey: string): Promise<VapidKeys> {
  const publicRaw = decodeKey(publicKey, KEY_BYTES, 'VAPID public key');
  decodeKey(privateKey, 32, 'VAPID private key');
  let signingKey: CryptoKey;
  let verifyKey: CryptoKey;
  try {
    signingKey = await crypto.subtle.importKey(
      'jwk',
      privateJwk(privateKey, publicRaw),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    verifyKey = await crypto.subtle.importKey(
      'raw',
      publicRaw,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  } catch {
    throw new Error('invalid VAPID key pair');
  }
  // بعض التنفيذات لا تتحقق أن d يطابق x,y عند الاستيراد: توقيع تجريبي يكشف عدم التطابق.
  const probe = enc.encode('vapid-key-check');
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, probe);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, sig, probe);
  if (!ok) throw new Error('VAPID key pair mismatch');
  return { publicKey, signingKey };
}

export const VAPID_EXPIRY_SECONDS = 12 * 3600;

/** ترويسة Authorization: `vapid t=<JWT ES256>, k=<public key>`. aud = أصل الـ endpoint. */
export async function vapidAuthorization(
  keys: VapidKeys,
  audience: string,
  subject: string,
  nowSeconds: number,
): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(
      JSON.stringify({ aud: audience, exp: nowSeconds + VAPID_EXPIRY_SECONDS, sub: subject }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  // WebCrypto يرجع ECDSA بصيغة r||s (64 بايت) وهي صيغة JOSE المطلوبة مباشرة.
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.signingKey,
      enc.encode(unsigned),
    ),
  );
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}
