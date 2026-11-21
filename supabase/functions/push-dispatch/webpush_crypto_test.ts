// pnpm test:functions — تشفير Web Push (RFC 8291) وترويسة VAPID (RFC 8292)، بلا شبكة.
import assert from 'node:assert/strict';
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  importVapidKeys,
  RECORD_SIZE,
  vapidAuthorization,
} from './webpush_crypto.ts';

// ------------------------------------------------- RFC 8291 Appendix A (المتجهات الرسمية)
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  header:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

// ------------------------------------------------- مساعدات الاختبار (فك التشفير بمفتاح المستلم)
const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', concat(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(salt), info: concat(info) },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

async function generateSubscriber() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: pair.privateKey, raw, p256dh: b64urlEncode(raw), auth: b64urlEncode(auth) };
}

/** فك حمولة aes128gcm كما يفعل المتصفح (RFC 8188 + 8291). */
async function decrypt(body: Uint8Array, uaPrivate: CryptoKey, uaRaw: Uint8Array, auth: string) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20]!;
  const asRaw = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asPublic = await crypto.subtle.importKey(
    'raw',
    concat(asRaw),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asPublic }, uaPrivate, 256),
  );
  const ikm = await hkdf(
    b64urlDecode(auth),
    ecdh,
    concat(enc.encode('WebPush: info\0'), uaRaw, asRaw),
    32,
  );
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', concat(cek), 'AES-GCM', false, ['decrypt']);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: concat(nonce) }, key, concat(ciphertext)),
  );
  assert.equal(record.at(-1), 2, 'last-record delimiter 0x02');
  return { rs, idlen, text: new TextDecoder().decode(record.slice(0, -1)) };
}

async function generateVapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64urlEncode(raw), privateKey: jwk.d as string, verifyKey: pair.publicKey };
}

// ------------------------------------------------- base64url
Deno.test('base64url: round trip without padding, URL-safe alphabet', () => {
  const bytes = new Uint8Array([0, 251, 255, 62, 63, 1, 2]);
  const s = b64urlEncode(bytes);
  assert.doesNotMatch(s, /[+/=]/);
  assert.deepEqual(b64urlDecode(s), bytes);
  assert.deepEqual(b64urlDecode('BTBZMqHH6r4Tts7J_aSIgg').length, 16);
});

Deno.test('base64url: rejects characters outside the alphabet', () => {
  assert.throws(() => b64urlDecode('abc$'));
  assert.throws(() => b64urlDecode('ab+/'));
});

// ------------------------------------------------- RFC 8291
Deno.test('RFC 8291 Appendix A: identical encrypted body (header + ciphertext)', async () => {
  const body = await encryptPayload(b64urlDecode(RFC.plaintext), RFC.uaPublic, RFC.authSecret, {
    serverKeys: { publicKey: RFC.asPublic, privateKey: RFC.asPrivate },
    salt: b64urlDecode(RFC.salt),
  });
  assert.equal(RECORD_SIZE, 4096);
  assert.equal(body.length, 86 + 58);
  assert.equal(b64urlEncode(body.slice(0, 86)), RFC.header);
  assert.equal(b64urlEncode(body.slice(86)), RFC.ciphertext);
});

Deno.test('RFC 8291 Appendix A: the subscriber key decrypts the vector body', async () => {
  const uaRaw = b64urlDecode(RFC.uaPublic);
  const uaPrivate = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: RFC.uaPrivate,
      x: b64urlEncode(uaRaw.slice(1, 33)),
      y: b64urlEncode(uaRaw.slice(33, 65)),
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const body = concat(b64urlDecode(RFC.header), b64urlDecode(RFC.ciphertext));
  const out = await decrypt(body, uaPrivate, uaRaw, RFC.authSecret);
  assert.equal(out.text, 'When I grow up, I want to be a watermelon');
  assert.equal(out.rs, 4096);
  assert.equal(out.idlen, 65);
});

Deno.test('encryptPayload: fresh ephemeral key + salt each time; subscriber decrypts', async () => {
  const sub = await generateSubscriber();
  const payload = enc.encode(JSON.stringify({ title: 'طلب جديد #12', body: 'بلوك A3 - بناية 4' }));
  const a = await encryptPayload(payload, sub.p256dh, sub.auth);
  const b = await encryptPayload(payload, sub.p256dh, sub.auth);
  assert.notDeepEqual(a.slice(0, 16), b.slice(0, 16), 'salt is random');
  assert.notDeepEqual(a.slice(21, 86), b.slice(21, 86), 'ephemeral key is random');
  const out = await decrypt(a, sub.privateKey, sub.raw, sub.auth);
  assert.deepEqual(JSON.parse(out.text), { title: 'طلب جديد #12', body: 'بلوك A3 - بناية 4' });
});

Deno.test('encryptPayload: rejects malformed subscription keys', async () => {
  const sub = await generateSubscriber();
  const p = enc.encode('x');
  await assert.rejects(() => encryptPayload(p, 'not-a-key', sub.auth));
  await assert.rejects(() => encryptPayload(p, b64urlEncode(new Uint8Array(65)), sub.auth));
  await assert.rejects(() => encryptPayload(p, sub.p256dh, b64urlEncode(new Uint8Array(8))));
  await assert.rejects(() => encryptPayload(new Uint8Array(RECORD_SIZE), sub.p256dh, sub.auth));
});

// ------------------------------------------------- VAPID (RFC 8292)
Deno.test(
  'VAPID: ES256 JWT signed by the private key, aud/exp/sub claims, k = public key',
  async () => {
    const v = await generateVapid();
    const keys = await importVapidKeys(v.publicKey, v.privateKey);
    const now = 1_800_000_000;
    const header = await vapidAuthorization(
      keys,
      'https://fcm.googleapis.com',
      'mailto:ops@example.com',
      now,
    );
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    assert.ok(m, header);
    const [, h, c, s, k] = m;
    assert.equal(k, v.publicKey);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(b64urlDecode(h!))), {
      typ: 'JWT',
      alg: 'ES256',
    });
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c!)));
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    assert.equal(claims.sub, 'mailto:ops@example.com');
    assert.ok(claims.exp > now && claims.exp <= now + 12 * 3600, 'exp within 12 hours');
    const sig = b64urlDecode(s!);
    assert.equal(sig.length, 64, 'raw r||s signature (JOSE), not DER');
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      v.verifyKey,
      concat(sig),
      enc.encode(`${h}.${c}`),
    );
    assert.ok(ok, 'signature verifies with the public key');
  },
);

Deno.test('VAPID: malformed or mismatched key pair is rejected', async () => {
  const a = await generateVapid();
  const b = await generateVapid();
  await assert.rejects(() => importVapidKeys(a.publicKey, b.privateKey), /mismatch/);
  await assert.rejects(() => importVapidKeys('short', a.privateKey));
  await assert.rejects(() => importVapidKeys(a.publicKey, 'short'));
});

Deno.test('VAPID: errors never contain the private key', async () => {
  const a = await generateVapid();
  const b = await generateVapid();
  for (const attempt of [
    () => importVapidKeys(a.publicKey, b.privateKey),
    () => importVapidKeys(a.publicKey, b.privateKey.slice(0, 20)),
  ]) {
    try {
      await attempt();
      assert.fail('should reject');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert.ok(!msg.includes(b.privateKey.slice(0, 12)), msg);
    }
  }
});
