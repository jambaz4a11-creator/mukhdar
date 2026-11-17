// pnpm test:functions (deno test، بدون شبكة: الاعتماديات مزيفة)
import assert from 'node:assert/strict';
import type { ProfileRow } from '../_shared/admin.ts';
import { createResetPinHandler, RESETS_PER_HOUR, type ResetPinDeps } from './handler.ts';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const ADMIN2 = '00000000-0000-4000-8000-000000000002';
const CUSTOMER = '00000000-0000-4000-8000-000000000101';
const STAFF = '00000000-0000-4000-8000-000000000003';
const OFF_ADMIN = '00000000-0000-4000-8000-000000000009';
const FLAGGED = '00000000-0000-4000-8000-000000000007';

// الرمز ← المستخدم ومستوى الجلسة (aal2 = PIN + تطبيق المصادقة، T23 C1)
const JWTS: Record<string, { id: string; aal: string | null }> = {
  'jwt-admin': { id: ADMIN, aal: 'aal2' },
  'jwt-admin-aal1': { id: ADMIN, aal: 'aal1' },
  'jwt-admin-no-aal': { id: ADMIN, aal: null },
  'jwt-staff': { id: STAFF, aal: 'aal2' },
  'jwt-off-admin': { id: OFF_ADMIN, aal: 'aal2' },
  'jwt-customer': { id: CUSTOMER, aal: 'aal1' },
  'jwt-flagged': { id: FLAGGED, aal: 'aal2' },
};
const PROFILES: Record<string, ProfileRow> = {
  [ADMIN]: { role: 'admin', is_active: true, phone: '9647000000001' },
  [ADMIN2]: { role: 'admin', is_active: true, phone: '9647000000005' },
  [OFF_ADMIN]: { role: 'admin', is_active: false, phone: '9647000000009' },
  [STAFF]: { role: 'staff', is_active: true, phone: '9647000000002' },
  [CUSTOMER]: { role: 'customer', is_active: true, phone: '9647701234567' },
  // أدمن برمز مؤقت لم يغيّره (must_change_pin)
  [FLAGGED]: { role: 'admin', is_active: true, phone: '9647000000007', must_change_pin: true },
};

/** count = ما يرجعه rateHit: عدد محاولات آخر ساعة شاملة المحاولة الحالية. */
function setup(overrides: Partial<ResetPinDeps> = {}, count = 1) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: ResetPinDeps = {
    getUser: (jwt) => Promise.resolve(JWTS[jwt] ?? null),
    getProfile: (id) => Promise.resolve(PROFILES[id] ?? null),
    rateHit() {
      calls.push('rate');
      return Promise.resolve(count);
    },
    updatePassword(userId, pin) {
      calls.push(`update:${userId}:${pin}`);
      return Promise.resolve();
    },
    revokeSessions(userId) {
      calls.push(`revoke:${userId}`);
      return Promise.resolve();
    },
    recordReset(userId, adminId) {
      calls.push(`record:${userId}:${adminId}`);
      return Promise.resolve();
    },
    log: (msg, extra) => logs.push(`${msg} ${JSON.stringify(extra ?? null)}`),
    ...overrides,
  };
  return { handler: createResetPinHandler(deps), calls, logs };
}

const post = (body: unknown, auth = 'Bearer jwt-admin') =>
  new Request('http://x/admin-reset-pin', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function expectResponse(res: Response, status: number, body: unknown) {
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), body);
}

Deno.test('admin-reset-pin: no or invalid JWT → 401, nothing changes', async () => {
  const { handler, calls } = setup();
  await expectResponse(await handler(post({}, '')), 401, { error: 'NOT_AUTHENTICATED' });
  await expectResponse(await handler(post({}, 'Bearer nope')), 401, {
    error: 'NOT_AUTHENTICATED',
  });
  assert.deepEqual(calls, []);
});

Deno.test('admin-reset-pin: non-admin or inactive admin → 403 NOT_ALLOWED', async () => {
  const { handler, calls } = setup();
  const body = { user_id: CUSTOMER, new_pin: '482915' };
  for (const jwt of ['jwt-staff', 'jwt-customer', 'jwt-off-admin']) {
    await expectResponse(await handler(post(body, `Bearer ${jwt}`)), 403, {
      error: 'NOT_ALLOWED',
    });
  }
  assert.deepEqual(calls, []);
});

Deno.test(
  'admin-reset-pin: an admin without a 2FA (aal2) session → 403 MFA_REQUIRED, nothing changes (T23 C1)',
  async () => {
    const { handler, calls } = setup();
    for (const jwt of ['jwt-admin-aal1', 'jwt-admin-no-aal']) {
      await expectResponse(
        await handler(post({ user_id: CUSTOMER, new_pin: '482915' }, `Bearer ${jwt}`)),
        403,
        { error: 'MFA_REQUIRED' },
      );
    }
    assert.deepEqual(calls, []); // لا حد معدل ولا تغيير
  },
);

Deno.test('admin-reset-pin: GET → 405; malformed body → 400', async () => {
  const { handler } = setup();
  const get = new Request('http://x', { headers: { Authorization: 'Bearer jwt-admin' } });
  assert.equal((await handler(get)).status, 405);
  await expectResponse(await handler(post('not json')), 400, { error: 'INVALID_REQUEST' });
  await expectResponse(await handler(post({ user_id: CUSTOMER })), 400, {
    error: 'INVALID_REQUEST',
  });
  await expectResponse(await handler(post({ user_id: CUSTOMER, new_pin: 482915 })), 400, {
    error: 'INVALID_REQUEST',
  });
});

Deno.test('admin-reset-pin: bad uuid or unknown user → 404', async () => {
  const { handler } = setup();
  await expectResponse(await handler(post({ user_id: 'x', new_pin: '482915' })), 404, {
    error: 'USER_NOT_FOUND',
  });
  await expectResponse(
    await handler(post({ user_id: '00000000-0000-4000-8000-0000000000ff', new_pin: '482915' })),
    404,
    { error: 'USER_NOT_FOUND' },
  );
});

Deno.test('admin-reset-pin: target admin (or self) → 403 ADMIN_ACCOUNT', async () => {
  const { handler, calls } = setup();
  for (const id of [ADMIN2, ADMIN]) {
    await expectResponse(await handler(post({ user_id: id, new_pin: '482915' })), 403, {
      error: 'ADMIN_ACCOUNT',
    });
  }
  assert.deepEqual(calls, []);
});

Deno.test('admin-reset-pin: easy PIN → 400 PIN_INVALID with the reason', async () => {
  const { handler, calls } = setup();
  const cases: [string, string][] = [
    ['123456', 'PIN_TRIVIAL'],
    ['000000', 'PIN_TRIVIAL'],
    ['12345', 'PIN_LENGTH'],
    ['234567', 'PIN_TRIVIAL'],
    ['770123', 'PIN_MATCHES_PHONE'], // من رقم الهدف 07701234567
  ];
  for (const [pin, detail] of cases) {
    await expectResponse(await handler(post({ user_id: CUSTOMER, new_pin: pin })), 400, {
      error: 'PIN_INVALID',
      detail,
    });
  }
  assert.deepEqual(calls, []); // الرفض قبل الحد وقبل أي تغيير
});

Deno.test('admin-reset-pin: the 21st attempt in the hour → 429 TOO_MANY_RESETS', async () => {
  const { handler, calls } = setup({}, RESETS_PER_HOUR + 1);
  await expectResponse(await handler(post({ user_id: CUSTOMER, new_pin: '482915' })), 429, {
    error: 'TOO_MANY_RESETS',
  });
  assert.deepEqual(calls, ['rate']); // المحاولة سُجّلت، ولا تغيير
  const atLimit = setup({}, RESETS_PER_HOUR);
  assert.equal((await atLimit.handler(post({ user_id: CUSTOMER, new_pin: '482915' }))).status, 200);
});

Deno.test(
  'admin-reset-pin: an admin with a temporary PIN is refused → 403 PIN_CHANGE_REQUIRED',
  async () => {
    const { handler, calls } = setup();
    await expectResponse(
      await handler(post({ user_id: CUSTOMER, new_pin: '482915' }, 'Bearer jwt-flagged')),
      403,
      { error: 'PIN_CHANGE_REQUIRED' },
    );
    assert.deepEqual(calls, []); // لا حد معدل ولا تغيير ولا إبطال جلسات
  },
);

Deno.test(
  'admin-reset-pin: PIN never reaches the logs even inside an error message (T6/L4)',
  async () => {
    const { handler, logs } = setup({
      updatePassword: () => Promise.reject(new Error('password 482915 rejected')),
    });
    await expectResponse(await handler(post({ user_id: CUSTOMER, new_pin: '482915' })), 500, {
      error: 'INTERNAL',
    });
    assert.ok(logs.length > 0);
    assert.ok(logs.every((l) => !l.includes('482915')));
    assert.ok(logs.some((l) => l.includes('***')));
    // الرمز بأرقام عربية: المُطبَّع (لاتيني) والخام كلاهما يُحجب
    const arabic = setup({
      revokeSessions: () => Promise.reject(new Error('x 482915 y ٤٨٢٩١٥')),
      recordReset: () => Promise.reject(new Error('z 482915')),
    });
    await expectResponse(
      await arabic.handler(post({ user_id: CUSTOMER, new_pin: '٤٨٢٩١٥' })),
      500,
      {
        error: 'RESET_INCOMPLETE',
      },
    );
    assert.ok(arabic.logs.every((l) => !l.includes('482915') && !l.includes('٤٨٢٩١٥')));
  },
);

Deno.test(
  'admin-reset-pin: success updates, revokes sessions, audits; PIN never returned or logged',
  async () => {
    const { handler, calls, logs } = setup();
    const res = await handler(post({ user_id: CUSTOMER.toUpperCase(), new_pin: '٤٨٢٩١٥' }));
    await expectResponse(res, 200, { ok: true });
    assert.deepEqual(calls, [
      'rate',
      `update:${CUSTOMER}:482915`, // أرقام عربية تُحوَّل
      `record:${CUSTOMER}:${ADMIN}`,
      `revoke:${CUSTOMER}`,
    ]);
    assert.ok(logs.every((l) => !l.includes('482915')));
    // موظف (غير أدمن) يُعاد ضبطه أيضاً
    assert.equal((await handler(post({ user_id: STAFF, new_pin: '482915' }))).status, 200);
  },
);

Deno.test('admin-reset-pin: update failure → 500, no revoke/audit', async () => {
  const { handler, calls } = setup({
    updatePassword: () => Promise.reject(new Error('auth down')),
  });
  await expectResponse(await handler(post({ user_id: CUSTOMER, new_pin: '482915' })), 500, {
    error: 'INTERNAL',
  });
  assert.deepEqual(calls, ['rate']);
});

Deno.test(
  'admin-reset-pin: revoke failure → RESET_INCOMPLETE after retries, still audited+flagged',
  async () => {
    let tries = 0;
    const { handler, calls } = setup({
      revokeSessions: () => {
        tries++;
        return Promise.reject(new Error('db down'));
      },
    });
    await expectResponse(await handler(post({ user_id: CUSTOMER, new_pin: '482915' })), 500, {
      error: 'RESET_INCOMPLETE',
    });
    assert.equal(tries, 3); // المحاولة الأولى + محاولتان
    assert.deepEqual(calls, ['rate', `update:${CUSTOMER}:482915`, `record:${CUSTOMER}:${ADMIN}`]);
  },
);

Deno.test(
  'admin-reset-pin: a transient audit failure is retried and the reset succeeds',
  async () => {
    let tries = 0;
    const { handler, calls } = setup({
      recordReset: (u, a) => {
        tries++;
        if (tries < 3) return Promise.reject(new Error('blip'));
        calls.push(`record:${u}:${a}`);
        return Promise.resolve();
      },
    });
    await expectResponse(await handler(post({ user_id: CUSTOMER, new_pin: '482915' })), 200, {
      ok: true,
    });
    assert.equal(tries, 3);
    assert.deepEqual(calls.slice(-2), [`record:${CUSTOMER}:${ADMIN}`, `revoke:${CUSTOMER}`]);
  },
);

Deno.test(
  'admin-reset-pin: audit failure → the typed PIN is overwritten with an unknown random one (no live known PIN)',
  async () => {
    const { handler, calls, logs } = setup({
      recordReset: () => Promise.reject(new Error('db down')),
    });
    await expectResponse(await handler(post({ user_id: CUSTOMER, new_pin: '482915' })), 500, {
      error: 'RESET_INCOMPLETE',
    });
    // 1) الرمز المكتوب، 2) بعد فشل التدقيق رمز عشوائي مختلف؛ لا إبطال جلسات ولا ردّ للرمز
    const updates = calls.filter((c) => c.startsWith('update:'));
    assert.equal(updates.length, 2);
    assert.equal(updates[0], `update:${CUSTOMER}:482915`);
    assert.match(updates[1], /:\d{6}$/);
    assert.ok(updates[1].startsWith(`update:${CUSTOMER}:`));
    assert.ok(!calls.some((c) => c.startsWith('revoke:')));
    assert.ok(logs.every((l) => !l.includes('482915')));
  },
);

Deno.test(
  'admin-reset-pin: audit AND rollback fail → still RESET_INCOMPLETE (never ok)',
  async () => {
    let n = 0;
    const { handler } = setup({
      updatePassword: () =>
        ++n === 1 ? Promise.resolve() : Promise.reject(new Error('auth down')),
      recordReset: () => Promise.reject(new Error('db down')),
    });
    await expectResponse(await handler(post({ user_id: CUSTOMER, new_pin: '482915' })), 500, {
      error: 'RESET_INCOMPLETE',
    });
  },
);
