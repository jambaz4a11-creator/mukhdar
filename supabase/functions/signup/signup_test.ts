// pnpm test:functions (deno test، بدون شبكة: الاعتماديات مزيفة)
import assert from 'node:assert/strict';
import { clientIp, createSignupHandler, type SignupDeps } from './handler.ts';

const SECRET_PIN = '482915';

function setup(overrides: Partial<SignupDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const existing = new Set(['9647700000009']);
  const deps: SignupDeps = {
    rateHit(ip, phone) {
      calls.push(`rate:${ip}:${phone}`);
      return Promise.resolve(true);
    },
    createUser(phone, pin) {
      calls.push(`create:${phone}:${pin}`);
      return Promise.resolve(existing.has(phone) ? 'exists' : 'created');
    },
    log: (msg, extra) => logs.push(`${msg} ${JSON.stringify(extra ?? null)}`),
    ...overrides,
  };
  return { handler: createSignupHandler(deps), calls, logs };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '5.6.7.8', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function call(handler: (r: Request) => Promise<Response>, req: Request) {
  const res = await handler(req);
  return { status: res.status, body: await res.json() };
}

Deno.test('creates the account: stored phone format, normalized PIN, 201', async () => {
  const { handler, calls } = setup();
  const r = await call(handler, post({ phone: '0770 123 4567', pin: '٤٨٢٩١٥' }));
  assert.deepEqual(r, { status: 201, body: { created: true } });
  assert.deepEqual(calls, ['rate:5.6.7.8:9647701234567', `create:9647701234567:${SECRET_PIN}`]);
});

Deno.test('a registered number → 409 PHONE_TAKEN', async () => {
  const { handler } = setup();
  const r = await call(handler, post({ phone: '07700000009', pin: SECRET_PIN }));
  assert.deepEqual(r, { status: 409, body: { error: 'PHONE_TAKEN' } });
});

Deno.test(
  'invalid phone → 400 PHONE_INVALID, counted on the IP only, no user created',
  async () => {
    const { handler, calls } = setup();
    const r = await call(handler, post({ phone: '0123', pin: SECRET_PIN }));
    assert.deepEqual(r, { status: 400, body: { error: 'PHONE_INVALID' } });
    assert.deepEqual(calls, ['rate:5.6.7.8:null']);
  },
);

Deno.test('server-side PIN rules (shared pin.ts) → 400 PIN_INVALID, no user created', async () => {
  for (const pin of ['123456', '000000', '12345', '1234567', 'abcdef', '770123', '']) {
    const { handler, calls } = setup();
    const r = await call(handler, post({ phone: '07701234567', pin }));
    assert.deepEqual(r, { status: 400, body: { error: 'PIN_INVALID' } }, pin);
    assert.ok(!calls.some((c) => c.startsWith('create:')), pin);
  }
  const { handler } = setup();
  const r = await call(handler, post({ phone: '07701234567', pin: 482915 }));
  assert.deepEqual(r, { status: 400, body: { error: 'PIN_INVALID' } }, 'a number, not a string');
});

Deno.test('rate limited → 429 before any validation or creation', async () => {
  const { handler, calls } = setup({
    rateHit: (ip, phone) => {
      calls.push(`rate:${ip}:${phone}`);
      return Promise.resolve(false);
    },
  });
  const r = await call(handler, post({ phone: '07701234567', pin: SECRET_PIN }));
  assert.deepEqual(r, { status: 429, body: { error: 'RATE_LIMITED' } });
  assert.deepEqual(calls, ['rate:5.6.7.8:9647701234567']);
});

Deno.test('malformed requests → generic SIGNUP_FAILED (still counted)', async () => {
  const { handler, calls } = setup();
  assert.deepEqual(await call(handler, post('not json')), {
    status: 400,
    body: { error: 'SIGNUP_FAILED' },
  });
  assert.deepEqual(await call(handler, post('[1,2]')), {
    status: 400,
    body: { error: 'SIGNUP_FAILED' },
  });
  assert.deepEqual(await call(handler, post({ phone: '07701234567', pin: 'x'.repeat(2000) })), {
    status: 400,
    body: { error: 'SIGNUP_FAILED' },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.startsWith('rate:')));
  const get = await call(handler, new Request('http://x/signup'));
  assert.deepEqual(get, { status: 405, body: { error: 'SIGNUP_FAILED' } });
});

Deno.test(
  'rate limiter or Auth failure → 500 SIGNUP_FAILED (fail closed), PIN never logged',
  async () => {
    const down = setup({ rateHit: () => Promise.reject(new Error('db down')) });
    assert.deepEqual(await call(down.handler, post({ phone: '07701234567', pin: SECRET_PIN })), {
      status: 500,
      body: { error: 'SIGNUP_FAILED' },
    });
    assert.ok(!down.calls.some((c) => c.startsWith('create:')));

    const broken = setup({
      createUser: () => Promise.reject(new Error('unexpected_failure: boom')),
    });
    const r = await call(broken.handler, post({ phone: '07701234567', pin: SECRET_PIN }));
    assert.deepEqual(r, { status: 500, body: { error: 'SIGNUP_FAILED' } });

    for (const { logs } of [down, broken, setup()]) {
      assert.ok(!logs.join('\n').includes(SECRET_PIN));
    }
    const ok = setup();
    await ok.handler(post({ phone: '07701234567', pin: SECRET_PIN }));
    assert.ok(ok.logs.length > 0 && !ok.logs.join('\n').includes(SECRET_PIN));
  },
);

Deno.test(
  'clientIp: Cloudflare header first, then the first x-forwarded-for hop, else "unknown"',
  () => {
    assert.equal(
      clientIp(new Headers({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' })),
      '9.9.9.9',
    );
    assert.equal(clientIp(new Headers({ 'x-forwarded-for': ' 1.1.1.1, 10.0.0.1' })), '1.1.1.1');
    assert.equal(clientIp(new Headers()), 'unknown');
  },
);
