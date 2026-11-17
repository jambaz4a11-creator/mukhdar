// pnpm test:functions (deno test، بدون شبكة: الاعتماديات مزيفة)
import assert from 'node:assert/strict';
import type { ProfileRow } from '../_shared/admin.ts';
import {
  createAdminCreateUserHandler,
  CREATIONS_PER_HOUR,
  type CreateUserDeps,
} from './handler.ts';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const STAFF = '00000000-0000-4000-8000-000000000003';
const FLAGGED = '00000000-0000-4000-8000-000000000007';
const NEW_ID = '00000000-0000-4000-8000-0000000000aa';

// الرمز ← المستخدم ومستوى الجلسة (aal2 = PIN + تطبيق المصادقة، T23 C1)
const JWTS: Record<string, { id: string; aal: string | null }> = {
  'jwt-admin': { id: ADMIN, aal: 'aal2' },
  'jwt-admin-aal1': { id: ADMIN, aal: 'aal1' },
  'jwt-staff': { id: STAFF, aal: 'aal2' },
  'jwt-flagged': { id: FLAGGED, aal: 'aal2' },
};
const PROFILES: Record<string, ProfileRow> = {
  [ADMIN]: { role: 'admin', is_active: true, phone: '9647000000001' },
  [STAFF]: { role: 'staff', is_active: true, phone: '9647000000002' },
  // أدمن برمز مؤقت لم يغيّره (must_change_pin)
  [FLAGGED]: { role: 'admin', is_active: true, phone: '9647000000007', must_change_pin: true },
};
const TAKEN = '9647709999999';

/** count = ما يرجعه rateHit: عدد محاولات آخر ساعة شاملة المحاولة الحالية. */
function setup(overrides: Partial<CreateUserDeps> = {}, count = 1) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: CreateUserDeps = {
    getUser: (jwt) => Promise.resolve(JWTS[jwt] ?? null),
    getProfile: (id) => Promise.resolve(PROFILES[id] ?? null),
    rateHit() {
      calls.push('rate');
      return Promise.resolve(count);
    },
    createUser(phone, pin) {
      calls.push(`create:${phone}:${pin}`);
      return Promise.resolve(phone === TAKEN ? 'exists' : { id: NEW_ID });
    },
    finish(userId, adminId, role, name) {
      calls.push(`finish:${userId}:${adminId}:${role}:${name}`);
      return Promise.resolve();
    },
    deleteUser(userId) {
      calls.push(`delete:${userId}`);
      return Promise.resolve();
    },
    log: (msg, extra) => logs.push(`${msg} ${JSON.stringify(extra ?? null)}`),
    ...overrides,
  };
  return { handler: createAdminCreateUserHandler(deps), calls, logs };
}

const VALID = { phone: '0770 123 4567', full_name: ' علي ', role: 'driver', pin: '482915' };

const post = (body: unknown, auth = 'Bearer jwt-admin') =>
  new Request('http://x/admin-create-user', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function expectResponse(res: Response, status: number, body: unknown) {
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), body);
}

Deno.test('admin-create-user: not signed in → 401; not admin → 403', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post(VALID, '')), 401, { error: 'NOT_AUTHENTICATED' });
  await expectResponse(await handler(post(VALID, 'Bearer jwt-staff')), 403, {
    error: 'NOT_ALLOWED',
  });
  assert.deepEqual(calls, []);
});

Deno.test('admin-create-user: admin and customer roles are refused', async () => {
  const { handler, calls } = setup();
  for (const role of ['admin', 'customer', 'root']) {
    await expectResponse(await handler(post({ ...VALID, role })), 400, { error: 'INVALID_ROLE' });
  }
  assert.deepEqual(calls, []);
});

Deno.test('admin-create-user: invalid phone, name or body', async () => {
  const { handler } = setup();
  await expectResponse(await handler(post({ ...VALID, phone: '12345' })), 400, {
    error: 'PHONE_INVALID',
  });
  await expectResponse(await handler(post({ ...VALID, full_name: '   ' })), 400, {
    error: 'INVALID_REQUEST',
  });
  await expectResponse(await handler(post({ ...VALID, full_name: 'x'.repeat(81) })), 400, {
    error: 'INVALID_REQUEST',
  });
  await expectResponse(await handler(post('[]')), 400, { error: 'INVALID_REQUEST' });
});

Deno.test('admin-create-user: easy PIN → 400 PIN_INVALID with the reason', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post({ ...VALID, pin: '111111' })), 400, {
    error: 'PIN_INVALID',
    detail: 'PIN_TRIVIAL',
  });
  await expectResponse(await handler(post({ ...VALID, pin: '770123' })), 400, {
    error: 'PIN_INVALID',
    detail: 'PIN_MATCHES_PHONE',
  });
  assert.deepEqual(calls, []);
});

Deno.test('admin-create-user: registered phone → 409 PHONE_TAKEN, no second account', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post({ ...VALID, phone: '07709999999' })), 409, {
    error: 'PHONE_TAKEN',
  });
  // المحاولة الفاشلة (رقم مسجّل) تُحسب بالحد أيضاً: لا استكشاف أرقام بلا سقف (L3)
  assert.deepEqual(calls, ['rate', `create:${TAKEN}:482915`]);
});

Deno.test(
  'admin-create-user: the 21st attempt in the hour → 429 (attempts count, not only successes)',
  async () => {
    const over = setup({}, CREATIONS_PER_HOUR + 1);
    await expectResponse(await over.handler(post(VALID)), 429, { error: 'RATE_LIMITED' });
    assert.deepEqual(over.calls, ['rate']); // سُجّلت المحاولة، ولا حساب أُنشئ
    const limit = setup({}, CREATIONS_PER_HOUR);
    await expectResponse(await limit.handler(post(VALID)), 201, { user_id: NEW_ID });
  },
);

Deno.test(
  'admin-create-user: an admin without a 2FA (aal2) session → 403 MFA_REQUIRED, nothing changes (T23 C1)',
  async () => {
    const { handler, calls } = setup();
    await expectResponse(await handler(post(VALID, 'Bearer jwt-admin-aal1')), 403, {
      error: 'MFA_REQUIRED',
    });
    assert.deepEqual(calls, []);
  },
);

Deno.test(
  'admin-create-user: an admin with a temporary PIN is refused → 403 PIN_CHANGE_REQUIRED',
  async () => {
    const { handler, calls } = setup();
    await expectResponse(await handler(post(VALID, 'Bearer jwt-flagged')), 403, {
      error: 'PIN_CHANGE_REQUIRED',
    });
    assert.deepEqual(calls, []); // لا حد معدل ولا إنشاء
  },
);

Deno.test(
  'admin-create-user: PIN never reaches the logs even inside an error message (T6/L4)',
  async () => {
    const leaky = setup({
      createUser: () => Promise.reject(new Error('invalid password 482915 for user')),
      finish: () => Promise.reject(new Error('db down 482915')),
    });
    await expectResponse(await leaky.handler(post(VALID)), 500, { error: 'INTERNAL' });
    assert.ok(leaky.logs.length > 0);
    assert.ok(leaky.logs.every((l) => !l.includes('482915')));
    assert.ok(leaky.logs.some((l) => l.includes('***')));
    // فشل التنظيف بعد finish أيضاً
    const cleanup = setup({
      finish: () => Promise.reject(new Error('x 482915')),
      deleteUser: () => Promise.reject(new Error('cannot delete 482915')),
    });
    await expectResponse(await cleanup.handler(post(VALID)), 500, { error: 'INTERNAL' });
    assert.ok(cleanup.logs.every((l) => !l.includes('482915')));
  },
);

Deno.test(
  'admin-create-user: success writes the role and audit; PIN not returned or logged',
  async () => {
    const { handler, calls, logs } = setup();
    await expectResponse(await handler(post(VALID)), 201, { user_id: NEW_ID });
    assert.deepEqual(calls, [
      'rate',
      'create:9647701234567:482915',
      `finish:${NEW_ID}:${ADMIN}:driver:علي`,
    ]);
    assert.ok(logs.every((l) => !l.includes('482915')));
  },
);

Deno.test('admin-create-user: failure after creation deletes the account → 500', async () => {
  const { handler, calls } = setup({ finish: () => Promise.reject(new Error('db down')) });
  await expectResponse(await handler(post({ ...VALID, role: 'staff' })), 500, {
    error: 'INTERNAL',
  });
  assert.deepEqual(calls, ['rate', 'create:9647701234567:482915', `delete:${NEW_ID}`]);
});

Deno.test('admin-create-user: createUser error → 500, nothing to clean', async () => {
  const { handler, calls } = setup({ createUser: () => Promise.reject(new Error('auth down')) });
  await expectResponse(await handler(post(VALID)), 500, { error: 'INTERNAL' });
  assert.deepEqual(calls, ['rate']);
});
