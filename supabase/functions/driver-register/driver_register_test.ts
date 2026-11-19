// pnpm test:functions (deno test، بلا شبكة: الاعتماديات مزيفة). T28، SPEC-driver §4.2.
import assert from 'node:assert/strict';
import { sha256Hex } from '../_shared/driver.ts';
import {
  createDriverRegisterHandler,
  type DriverRegisterDeps,
  type SubmitError,
} from './handler.ts';

const SECRET = 'q'.repeat(42) + 'A'; // 43 محرفاً base64url = 32 بايت
const PHONE = '9647701234567';

function setup(overrides: Partial<DriverRegisterDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: DriverRegisterDeps = {
    rateHit(ip, phone) {
      calls.push(`rate:${ip}:${phone}`);
      return Promise.resolve(true);
    },
    submit(input) {
      calls.push(`submit:${input.phone}:${input.fullName}:${input.secretHash}:${input.pushToken}`);
      return Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' });
    },
    log: (msg, extra) => logs.push(`${msg} ${JSON.stringify(extra ?? null)}`),
    ...overrides,
  };
  return { handler: createDriverRegisterHandler(deps), calls, logs };
}

const body = (over: Record<string, unknown> = {}) => ({
  full_name: '  أحمد علي ',
  phone: '0770 123 4567',
  device_secret: SECRET,
  push_token: 'ExponentPushToken[abc]',
  ...over,
});

const post = (b: unknown, headers: Record<string, string> = {}) =>
  new Request('https://ref.supabase.co/functions/v1/driver-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '5.6.7.8', ...headers },
    body: typeof b === 'string' ? b : JSON.stringify(b),
  });

async function call(handler: (r: Request) => Promise<Response>, req: Request) {
  const res = await handler(req);
  return { status: res.status, body: await res.json() };
}

Deno.test(
  '201 {request_id}: stored phone, trimmed name, SHA-256 of the secret, Expo token',
  async () => {
    const { handler, calls } = setup();
    const r = await call(handler, post(body()));
    assert.equal(r.status, 201);
    assert.deepEqual(r.body, { request_id: '11111111-2222-4333-8444-555555555555' });
    assert.deepEqual(calls, [
      `rate:5.6.7.8:${PHONE}`,
      `submit:${PHONE}:أحمد علي:${await sha256Hex(SECRET)}:ExponentPushToken[abc]`,
    ]);
  },
);

Deno.test(
  'the rate limit is checked first, before any validation (malformed bodies count too)',
  async () => {
    for (const b of ['not json', body({ phone: 'x' }), body({ device_secret: 'short' })]) {
      const { handler, calls } = setup({ rateHit: () => Promise.resolve(false) });
      const r = await call(handler, post(b));
      assert.equal(r.status, 429);
      assert.deepEqual(r.body, { error: 'RATE_LIMITED' });
      assert.ok(!calls.some((c) => c.startsWith('submit')));
    }
    const { handler, calls } = setup();
    await call(handler, post('not json'));
    assert.deepEqual(calls, ['rate:5.6.7.8:null'], 'invalid body: counted on the IP only');
  },
);

Deno.test(
  'the IP is the platform header: a forged X-Forwarded-For does not move the key',
  async () => {
    const { handler, calls } = setup();
    await call(
      handler,
      post(body(), { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.10' }),
    );
    assert.equal(calls[0], `rate:5.6.7.8:${PHONE}`);
    const noPlatform = setup();
    const req = new Request('https://x/driver-register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body()),
    });
    await call(noPlatform.handler, req);
    assert.equal(noPlatform.calls[0], `rate:unknown:${PHONE}`, 'no platform header → shared key');
  },
);

Deno.test('rate check failure fails closed: 500 REGISTER_FAILED, nothing submitted', async () => {
  const { handler, calls } = setup({ rateHit: () => Promise.reject(new Error('db down')) });
  const r = await call(handler, post(body()));
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: 'REGISTER_FAILED' });
  assert.equal(calls.length, 0);
});

Deno.test('validation codes (400) and no submit', async () => {
  const cases: [unknown, string][] = [
    ['not json', 'INVALID_REQUEST'],
    [[1, 2], 'INVALID_REQUEST'],
    [body({ phone: '0612345678' }), 'PHONE_INVALID'],
    [body({ phone: 7701234567 }), 'PHONE_INVALID'],
    [body({ full_name: ' ع ' }), 'NAME_INVALID'],
    [body({ full_name: 'س'.repeat(81) }), 'NAME_INVALID'],
    [body({ full_name: 12 }), 'NAME_INVALID'],
    [body({ device_secret: 'a'.repeat(42) }), 'INVALID_REQUEST'],
    [body({ device_secret: undefined }), 'INVALID_REQUEST'],
  ];
  for (const [b, code] of cases) {
    const { handler, calls } = setup();
    const r = await call(handler, post(b));
    assert.equal(r.status, 400, `${JSON.stringify(b)}`);
    assert.deepEqual(r.body, { error: code });
    assert.ok(!calls.some((c) => c.startsWith('submit')));
  }
});

Deno.test('wrong method → 405 INVALID_REQUEST', async () => {
  const { handler } = setup();
  const r = await call(handler, new Request('https://x/driver-register', { method: 'GET' }));
  assert.equal(r.status, 405);
  assert.deepEqual(r.body, { error: 'INVALID_REQUEST' });
});

Deno.test('a push token that is not an Expo token is ignored (null), not an error', async () => {
  for (const token of [
    'garbage',
    42,
    'ExponentPushToken[]',
    `ExponentPushToken[${'x'.repeat(300)}]`,
  ]) {
    const { handler, calls } = setup();
    const r = await call(handler, post(body({ push_token: token })));
    assert.equal(r.status, 201);
    assert.match(calls[1] ?? '', /:null$/);
  }
});

Deno.test(
  'database codes map to the documented statuses; anything else is REGISTER_FAILED',
  async () => {
    const map: [SubmitError | string, number, string][] = [
      ['PHONE_TAKEN', 409, 'PHONE_TAKEN'],
      ['REQUEST_EXISTS', 409, 'REQUEST_EXISTS'],
      ['TOO_MANY_PENDING', 429, 'TOO_MANY_PENDING'],
      ['NAME_INVALID', 400, 'NAME_INVALID'],
      ['PHONE_INVALID', 400, 'PHONE_INVALID'],
      ['INVALID_REQUEST', 400, 'INVALID_REQUEST'],
      ['permission denied for function submit_driver_request', 500, 'REGISTER_FAILED'],
    ];
    for (const [err, status, code] of map) {
      const { handler } = setup({ submit: () => Promise.resolve({ error: err }) });
      const r = await call(handler, post(body()));
      assert.equal(r.status, status, err);
      assert.deepEqual(r.body, { error: code }, 'generic code only, no database text');
    }
    const thrown = setup({ submit: () => Promise.reject(new Error('fetch failed')) });
    const r = await call(thrown.handler, post(body()));
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: 'REGISTER_FAILED' });
  },
);

Deno.test(
  'logs never contain the device secret, its hash, the push token or the full phone',
  async () => {
    const hash = await sha256Hex(SECRET);
    const runs = [
      setup(),
      setup({ rateHit: () => Promise.reject(new Error(`boom ${PHONE} ${SECRET}`)) }),
      setup({ submit: () => Promise.reject(new Error(`db ${PHONE} ${hash} ${SECRET}`)) }),
      setup({ submit: () => Promise.resolve({ error: `weird ${PHONE} ${hash}` }) }),
    ];
    for (const { handler, logs } of runs) {
      await handler(post(body()));
      assert.ok(logs.length > 0);
      const all = logs.join('\n');
      for (const s of [SECRET, hash, PHONE, '7701234567', 'ExponentPushToken[abc]', 'أحمد']) {
        assert.ok(!all.includes(s), `log leaked ${s}: ${all}`);
      }
    }
  },
);
