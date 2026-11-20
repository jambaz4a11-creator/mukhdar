// pnpm test:functions (deno test، بلا شبكة: الاعتماديات مزيفة). T28، SPEC-driver §4.4.
import assert from 'node:assert/strict';
import { sha256Hex } from '../_shared/driver.ts';
import {
  createDriverCompleteHandler,
  type BeginResult,
  type DriverCompleteDeps,
} from './handler.ts';

const SECRET = 'z'.repeat(42) + 'Q';
const PIN = '482915';
const PHONE = '9647701234567';
const REQ = '11111111-2222-4333-8444-555555555555';
const USER = '99999999-8888-4777-8666-555555555555';

function setup(overrides: Partial<DriverCompleteDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: DriverCompleteDeps = {
    rateHit(ip) {
      calls.push(`rate:${ip}`);
      return Promise.resolve(true);
    },
    begin(requestId, secretHash) {
      calls.push(`begin:${requestId}:${secretHash}`);
      return Promise.resolve({ phone: PHONE, fullName: 'أحمد علي' });
    },
    createUser(phone, pin) {
      calls.push(`create:${phone}:${pin}`);
      return Promise.resolve({ id: USER });
    },
    finish(requestId, userId) {
      calls.push(`finish:${requestId}:${userId}`);
      return Promise.resolve();
    },
    deleteUser(userId) {
      calls.push(`delete:${userId}`);
      return Promise.resolve();
    },
    accountExists(phone) {
      calls.push(`exists?:${phone}`);
      return Promise.resolve(false);
    },
    log: (msg, extra) => logs.push(`${msg} ${JSON.stringify(extra ?? null)}`),
    ...overrides,
  };
  return { handler: createDriverCompleteHandler(deps), calls, logs };
}

const body = (over: Record<string, unknown> = {}) => ({
  request_id: REQ,
  device_secret: SECRET,
  pin: '٤٨٢٩١٥',
  ...over,
});
const post = (b: unknown, headers: Record<string, string> = {}) =>
  new Request('https://ref.supabase.co/functions/v1/driver-complete-registration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '5.6.7.8', ...headers },
    body: typeof b === 'string' ? b : JSON.stringify(b),
  });
async function call(handler: (r: Request) => Promise<Response>, req: Request) {
  const res = await handler(req);
  return { status: res.status, body: await res.json() };
}

Deno.test(
  '201 {created: true}: rate → begin(hash) → createUser(normalized PIN) → finish, in order',
  async () => {
    const { handler, calls } = setup();
    const r = await call(handler, post(body()));
    assert.equal(r.status, 201);
    assert.deepEqual(r.body, { created: true });
    assert.deepEqual(calls, [
      'rate:5.6.7.8',
      `begin:${REQ}:${await sha256Hex(SECRET)}`,
      `create:${PHONE}:${PIN}`,
      `finish:${REQ}:${USER}`,
    ]);
  },
);

Deno.test(
  'the IP limit comes first: 429 even for a malformed body, nothing else runs',
  async () => {
    for (const b of ['nope', body(), body({ pin: '1' })]) {
      const { handler, calls } = setup({ rateHit: () => Promise.resolve(false) });
      const r = await call(handler, post(b));
      assert.equal(r.status, 429);
      assert.deepEqual(r.body, { error: 'RATE_LIMITED' });
      assert.equal(calls.length, 0);
    }
  },
);

Deno.test('the IP key is the platform header, not a forged X-Forwarded-For', async () => {
  const { handler, calls } = setup();
  await call(handler, post(body(), { 'x-forwarded-for': '203.0.113.9' }));
  assert.equal(calls[0], 'rate:5.6.7.8');
});

Deno.test('rate check failure fails closed (500 INTERNAL)', async () => {
  const { handler, calls } = setup({ rateHit: () => Promise.reject(new Error('down')) });
  const r = await call(handler, post(body()));
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: 'INTERNAL' });
  assert.equal(calls.length, 0);
});

Deno.test('malformed body → 400 INVALID_REQUEST without touching the database', async () => {
  for (const b of [
    'nope',
    body({ request_id: 'not-a-uuid' }),
    body({ device_secret: 'short' }),
    body({ pin: 482915 }),
    body({ request_id: undefined }),
  ]) {
    const { handler, calls } = setup();
    const r = await call(handler, post(b));
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.deepEqual(r.body, { error: 'INVALID_REQUEST' });
    assert.deepEqual(calls, ['rate:5.6.7.8']);
  }
});

Deno.test(
  'begin errors: wrong secret / pending / rejected / expired → documented status, no account',
  async () => {
    const map: [BeginResult, number, string][] = [
      [{ error: 'REQUEST_NOT_FOUND' }, 404, 'REQUEST_NOT_FOUND'],
      [{ error: 'REQUEST_NOT_APPROVED' }, 409, 'REQUEST_NOT_APPROVED'],
      [{ error: 'REQUEST_EXPIRED' }, 410, 'REQUEST_EXPIRED'],
      [{ error: 'something else' }, 500, 'INTERNAL'],
    ];
    for (const [res, status, code] of map) {
      const { handler, calls } = setup({ begin: () => Promise.resolve(res) });
      const r = await call(handler, post(body()));
      assert.equal(r.status, status);
      assert.deepEqual(r.body, { error: code });
      assert.ok(!calls.some((c) => c.startsWith('create')), 'no account is created');
    }
  },
);

Deno.test(
  'PIN is validated on the server against the request phone: 400 PIN_INVALID with detail',
  async () => {
    const cases: [string, string][] = [
      ['123456', 'PIN_TRIVIAL'],
      ['12345', 'PIN_LENGTH'],
      [PHONE.slice(-6), 'PIN_FROM_PHONE'],
    ];
    for (const [pin, detail] of cases) {
      const { handler, calls } = setup();
      const r = await call(handler, post(body({ pin })));
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'PIN_INVALID');
      assert.equal(typeof r.body.detail, 'string');
      if (detail !== 'PIN_FROM_PHONE') assert.equal(r.body.detail, detail);
      assert.ok(!calls.some((c) => c.startsWith('create')));
    }
  },
);

Deno.test(
  'GoTrue says the phone exists → 409 PHONE_TAKEN, request untouched, nothing deleted',
  async () => {
    const { handler, calls } = setup({ createUser: () => Promise.resolve('exists') });
    const r = await call(handler, post(body()));
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: 'PHONE_TAKEN' });
    assert.ok(!calls.some((c) => c.startsWith('finish') || c.startsWith('delete')));
  },
);

Deno.test(
  'concurrent race: GoTrue fails with a database error but the phone now has an account → 409 PHONE_TAKEN',
  async () => {
    // على dev: الخاسر بسباق ضغطتين يأخذ أحياناً "Database error creating new user" بدل phone_exists
    const { handler, calls } = setup({
      createUser: () =>
        Promise.reject(new Error('unexpected_failure: Database error creating new user')),
      accountExists: () => Promise.resolve(true),
    });
    const r = await call(handler, post(body()));
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: 'PHONE_TAKEN' });
    assert.ok(!calls.some((c) => c.startsWith('finish') || c.startsWith('delete')));
  },
);

Deno.test('createUser failure and the account check fails too → 500 INTERNAL', async () => {
  const { handler } = setup({
    createUser: () => Promise.reject(new Error('auth down')),
    accountExists: () => Promise.reject(new Error('db down')),
  });
  const r = await call(handler, post(body()));
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: 'INTERNAL' });
});

Deno.test('createUser failure → 500 INTERNAL, no finish', async () => {
  const { handler, calls } = setup({ createUser: () => Promise.reject(new Error('auth down')) });
  const r = await call(handler, post(body()));
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: 'INTERNAL' });
  assert.ok(!calls.some((c) => c.startsWith('finish')));
  assert.equal(calls.at(-1), `exists?:${PHONE}`, 'checked whether a racing call created it');
});

Deno.test(
  'finish failure with an unknown error deletes the created account (no orphan customer) → 500 INTERNAL',
  async () => {
    const { handler, calls } = setup({
      finish: () => Promise.reject(new Error('connection reset')),
    });
    const r = await call(handler, post(body()));
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: 'INTERNAL' });
    assert.equal(calls.at(-1), `delete:${USER}`);
  },
);

// الموافقة انتهت بين begin وfinish (R1 L1: finish يتحقق من approved_until): 4xx واضح لا 500، والحساب المُنشأ يُحذف.
for (const [code, status] of [
  ['REQUEST_EXPIRED', 410],
  ['REQUEST_NOT_APPROVED', 409],
  ['REQUEST_NOT_FOUND', 404],
] as const) {
  Deno.test(`finish refuses with ${code} → ${status} ${code}, account rolled back`, async () => {
    const { handler, calls } = setup({ finish: () => Promise.reject(new Error(code)) });
    const r = await call(handler, post(body()));
    assert.equal(r.status, status);
    assert.deepEqual(r.body, { error: code });
    assert.equal(calls.at(-1), `delete:${USER}`, 'no orphan customer account is left behind');
  });
}

Deno.test(
  'finish and delete both fail: still 500, the orphan account id is logged for the admin',
  async () => {
    const { handler, logs } = setup({
      finish: () => Promise.reject(new Error('x')),
      deleteUser: () => Promise.reject(new Error('y')),
    });
    const r = await call(handler, post(body()));
    assert.equal(r.status, 500);
    assert.ok(logs.some((l) => l.includes(USER) && /orphan/i.test(l)));
  },
);

Deno.test('two concurrent confirmations: one account; the second gets PHONE_TAKEN', async () => {
  const accounts = new Set<string>();
  let status: 'approved' | 'completed' = 'approved';
  const deps: Partial<DriverCompleteDeps> = {
    begin: () =>
      Promise.resolve(
        status === 'approved' ? { phone: PHONE, fullName: 'x' } : { error: 'REQUEST_NOT_APPROVED' },
      ),
    createUser: async (phone) => {
      await new Promise((r) => setTimeout(r, 5));
      if (accounts.has(phone)) return 'exists';
      accounts.add(phone);
      return { id: USER };
    },
    finish: () => {
      status = 'completed';
      return Promise.resolve();
    },
  };
  const { handler } = setup(deps);
  const [a, b] = await Promise.all([call(handler, post(body())), call(handler, post(body()))]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(accounts.size, 1);
  assert.equal(status, 'completed');
});

Deno.test('logs never contain the PIN, the device secret, its hash or the full phone', async () => {
  const hash = await sha256Hex(SECRET);
  const leak = `${PIN} ${SECRET} ${hash} ${PHONE}`;
  const runs = [
    setup(),
    setup({ rateHit: () => Promise.reject(new Error(leak)) }),
    setup({ begin: () => Promise.reject(new Error(leak)) }),
    setup({ createUser: () => Promise.reject(new Error(leak)) }),
    setup({
      createUser: () => Promise.reject(new Error(leak)),
      accountExists: () => Promise.reject(new Error(leak)),
    }),
    setup({
      finish: () => Promise.reject(new Error(leak)),
      deleteUser: () => Promise.reject(new Error(leak)),
    }),
  ];
  for (const { handler, logs } of runs) {
    await handler(post(body()));
    assert.ok(logs.length > 0);
    const all = logs.join('\n');
    for (const s of [PIN, '٤٨٢٩١٥', SECRET, hash, PHONE, '7701234567']) {
      assert.ok(!all.includes(s), `log leaked ${s}: ${all}`);
    }
  }
});

Deno.test('wrong method → 405 INVALID_REQUEST', async () => {
  const { handler } = setup();
  const r = await call(handler, new Request('https://x/y', { method: 'GET' }));
  assert.equal(r.status, 405);
});
