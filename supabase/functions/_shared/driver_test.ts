// pnpm test:functions: مساعدات دالتي تسجيل السائق (T28، SPEC-driver §4.2/§4.4)
import assert from 'node:assert/strict';
import {
  isDeviceSecret,
  maskPhone,
  platformClientIp,
  readSmallJson,
  rejectForeignOrigin,
  sha256Hex,
} from './driver.ts';

const req = (headers: Record<string, string>, body = '{}', method = 'POST') =>
  new Request('https://ref.supabase.co/functions/v1/x', {
    method,
    headers,
    body: method === 'GET' ? undefined : body,
  });

Deno.test(
  'platformClientIp: only cf-connecting-ip (set by Cloudflare), never X-Forwarded-For',
  () => {
    assert.equal(
      platformClientIp(
        new Headers({ 'cf-connecting-ip': ' 9.9.9.9 ', 'x-forwarded-for': '1.1.1.1' }),
      ),
      '9.9.9.9',
    );
    // بلا ترويسة المنصة: مفتاح مشترك (أحوط)، لا قيمة يتحكم بها العميل
    assert.equal(
      platformClientIp(new Headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })),
      'unknown',
    );
    assert.equal(platformClientIp(new Headers({ 'x-real-ip': '3.3.3.3' })), 'unknown');
    assert.equal(platformClientIp(new Headers()), 'unknown');
  },
);

Deno.test('isDeviceSecret: base64url without padding decoding to exactly 32 bytes', () => {
  const ok = btoa(String.fromCharCode(...new Uint8Array(32).fill(251)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.equal(ok.length, 43);
  assert.equal(isDeviceSecret(ok), true);
  assert.equal(isDeviceSecret('a'.repeat(42) + 'A'), true);
  assert.equal(
    isDeviceSecret('a'.repeat(42) + 'B'),
    false,
    'last char carries non-zero padding bits',
  );
  assert.equal(isDeviceSecret('a'.repeat(42)), false);
  assert.equal(isDeviceSecret('a'.repeat(44)), false);
  assert.equal(isDeviceSecret('a'.repeat(42) + '='), false);
  assert.equal(isDeviceSecret('a'.repeat(42) + '+'), false, 'standard base64 alphabet is refused');
  assert.equal(isDeviceSecret(42), false);
  assert.equal(isDeviceSecret(null), false);
});

Deno.test(
  'sha256Hex: hex SHA-256 of the UTF-8 text (same as the DB driver_request_status)',
  async () => {
    assert.equal(
      await sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  },
);

Deno.test('maskPhone: logs never carry a full phone number', () => {
  assert.equal(maskPhone('9647701234567'), '9647******67');
  assert.equal(maskPhone(null), '-');
});

Deno.test('readSmallJson: object only, bounded size (stops reading a huge body)', async () => {
  assert.deepEqual(await readSmallJson(req({}, '{"a":1}')), { a: 1 });
  assert.equal(await readSmallJson(req({}, '[1]')), null);
  assert.equal(await readSmallJson(req({}, 'not json')), null);
  assert.equal(await readSmallJson(req({}, '')), null);
  assert.equal(await readSmallJson(req({}, `{"a":"${'x'.repeat(5000)}"}`)), null);
});

Deno.test(
  'rejectForeignOrigin: no Origin (native app) and allowed origins pass; others get 403 before any work',
  async () => {
    let calls = 0;
    const handler = rejectForeignOrigin(
      () => {
        calls++;
        return Promise.resolve(new Response('ok'));
      },
      new Set(['https://app.example']),
    );
    assert.equal((await handler(req({}))).status, 200);
    assert.equal((await handler(req({ origin: 'https://app.example' }))).status, 200);
    const evil = await handler(req({ origin: 'https://evil.example' }));
    assert.equal(evil.status, 403);
    assert.deepEqual(await evil.json(), { error: 'NOT_ALLOWED' });
    assert.equal(calls, 2);
  },
);
