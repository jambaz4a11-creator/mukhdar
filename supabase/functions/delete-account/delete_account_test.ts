// pnpm test:functions (deno test، بدون شبكة: الاعتماديات مزيفة)
import assert from 'node:assert/strict';
import { createDeleteAccountHandler, type DeleteAccountDeps } from './handler.ts';

const USERS: Record<string, string> = {
  'jwt-customer': 'u-customer',
  'jwt-active': 'u-active',
  'jwt-cash': 'u-cash',
  'jwt-admin': 'u-admin',
  'jwt-broken': 'u-broken',
};

function setup(overrides: Partial<DeleteAccountDeps> = {}) {
  const calls: string[] = [];
  const deps: DeleteAccountDeps = {
    getUserId: (jwt) => Promise.resolve(USERS[jwt] ?? null),
    begin(userId) {
      calls.push(`begin:${userId}`);
      if (userId === 'u-active') return Promise.reject(new Error('ACTIVE_ORDER'));
      if (userId === 'u-admin') return Promise.reject(new Error('ADMIN_ACCOUNT'));
      if (userId === 'u-cash') return Promise.reject(new Error('CASH_OUTSTANDING'));
      return Promise.resolve(true);
    },
    deleteUser(userId) {
      calls.push(`deleteUser:${userId}`);
      if (userId === 'u-broken') return Promise.reject(new Error('auth down'));
      return Promise.resolve();
    },
    abort(userId, wasActive) {
      calls.push(`abort:${userId}:${wasActive}`);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { handler: createDeleteAccountHandler(deps), calls };
}

const post = (auth?: string) =>
  new Request('http://x/delete-account', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
  });

async function expectResponse(res: Response, status: number, body: unknown) {
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), body);
}

Deno.test('delete-account: no JWT → 401, nothing deleted', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post()), 401, { error: 'NOT_AUTHENTICATED' });
  await expectResponse(await handler(post('Basic abc')), 401, { error: 'NOT_AUTHENTICATED' });
  assert.deepEqual(calls, []);
});

Deno.test('delete-account: invalid / expired JWT → 401', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post('Bearer jwt-unknown')), 401, {
    error: 'NOT_AUTHENTICATED',
  });
  const throwing = setup({ getUserId: () => Promise.reject(new Error('network')) });
  await expectResponse(await throwing.handler(post('Bearer jwt-customer')), 401, {
    error: 'NOT_AUTHENTICATED',
  });
  assert.deepEqual(calls, []);
});

Deno.test('delete-account: active order → 409 ACTIVE_ORDER, deleteUser not called', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post('Bearer jwt-active')), 409, { error: 'ACTIVE_ORDER' });
  assert.deepEqual(calls, ['begin:u-active']);
});

Deno.test(
  'delete-account: driver holding cash → 409 CASH_OUTSTANDING, deleteUser not called (T40)',
  async () => {
    const { handler, calls } = setup();
    await expectResponse(await handler(post('Bearer jwt-cash')), 409, {
      error: 'CASH_OUTSTANDING',
    });
    assert.deepEqual(calls, ['begin:u-cash']);
  },
);

Deno.test('delete-account: admin → 403 ADMIN_ACCOUNT, deleteUser not called', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post('Bearer jwt-admin')), 403, { error: 'ADMIN_ACCOUNT' });
  assert.deepEqual(calls, ['begin:u-admin']);
});

Deno.test('delete-account: success → deleteUser(uid of the JWT) → 200', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post('Bearer jwt-customer')), 200, { deleted: true });
  assert.deepEqual(calls, ['begin:u-customer', 'deleteUser:u-customer']);
});

Deno.test('delete-account: deleteUser fails → abort restores the account → 500', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post('Bearer jwt-broken')), 500, { error: 'delete failed' });
  assert.deepEqual(calls, ['begin:u-broken', 'deleteUser:u-broken', 'abort:u-broken:true']);
});

Deno.test('delete-account: unexpected begin error → 500 without details', async () => {
  const { handler, calls } = setup({ begin: () => Promise.reject(new Error('connection reset')) });
  await expectResponse(await handler(post('Bearer jwt-customer')), 500, { error: 'delete failed' });
  assert.deepEqual(calls, []);
});

Deno.test('delete-account: POST only', async () => {
  const { handler, calls } = setup();
  const res = await handler(
    new Request('http://x', { method: 'GET', headers: { Authorization: 'Bearer jwt-customer' } }),
  );
  assert.equal(res.status, 405);
  assert.deepEqual(calls, []);
});
