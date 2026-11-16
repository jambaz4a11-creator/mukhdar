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
const NEW_ID = '00000000-0000-4000-8000-0000000000aa';

const JWTS: Record<string, string> = { 'jwt-admin': ADMIN, 'jwt-staff': STAFF };
const PROFILES: Record<string, ProfileRow> = {
  [ADMIN]: { role: 'admin', is_active: true, phone: '9647000000001' },
  [STAFF]: { role: 'staff', is_active: true, phone: '9647000000002' },
};
const TAKEN = '9647709999999';

function setup(overrides: Partial<CreateUserDeps> = {}, count = 0) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: CreateUserDeps = {
    getUserId: (jwt) => Promise.resolve(JWTS[jwt] ?? null),
    getProfile: (id) => Promise.resolve(PROFILES[id] ?? null),
    creationsLastHour: () => Promise.resolve(count),
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
  assert.deepEqual(calls, [`create:${TAKEN}:482915`]);
});

Deno.test('admin-create-user: 20 creations in the hour → 429', async () => {
  const { handler, calls } = setup({}, CREATIONS_PER_HOUR);
  await expectResponse(await handler(post(VALID)), 429, { error: 'RATE_LIMITED' });
  assert.deepEqual(calls, []);
});

Deno.test(
  'admin-create-user: success writes the role and audit; PIN not returned or logged',
  async () => {
    const { handler, calls, logs } = setup();
    await expectResponse(await handler(post(VALID)), 201, { user_id: NEW_ID });
    assert.deepEqual(calls, [
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
  assert.deepEqual(calls, ['create:9647701234567:482915', `delete:${NEW_ID}`]);
});

Deno.test('admin-create-user: createUser error → 500, nothing to clean', async () => {
  const { handler, calls } = setup({ createUser: () => Promise.reject(new Error('auth down')) });
  await expectResponse(await handler(post(VALID)), 500, { error: 'INTERNAL' });
  assert.deepEqual(calls, []);
});
