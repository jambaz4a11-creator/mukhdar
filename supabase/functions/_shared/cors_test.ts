// pnpm test:functions. T23 H1: Supabase المستضاف لا يضيف CORS للدوال (Kong المحلي يضيفه)، فكان CI يخفي أن
// لوحة الأدمن على Vercel لا تستطيع استدعاء admin-reset-pin وadmin-create-user: الـ preflight كان يرجع 405 بلا
// ترويسات CORS. هذه الاختبارات تستدعي **ما تخدمه index.ts نفسه** (create*Server) بلا Kong، فتعيد إنتاج ذلك الخلل
// لو عاد، وتفحص أن index.ts يخدم النسخة الملفوفة بـ CORS وبأصول ALLOWED_ORIGINS.
import assert from 'node:assert/strict';
import { createResetPinServer, type ResetPinDeps } from '../admin-reset-pin/handler.ts';
import { createAdminCreateUserServer, type CreateUserDeps } from '../admin-create-user/handler.ts';
import { createSignupServer, type SignupDeps } from '../signup/handler.ts';
import { createDeleteAccountServer, type DeleteAccountDeps } from '../delete-account/handler.ts';
import { jwtAal } from './admin.ts';
import { CORS_ALLOW_HEADERS, parseAllowedOrigins, withCors } from './cors.ts';

const PANEL = 'https://admin.mukhdar.example';
const DEV_PANEL = 'http://localhost:3000';
const ALLOWED = parseAllowedOrigins(`${PANEL}, ${DEV_PANEL}/`);
const ADMIN = '00000000-0000-4000-8000-000000000001';

// اعتماديات لا تُستدعى في الـ preflight؛ أي استدعاء = خطأ
const never = () => Promise.reject(new Error('must not be called'));
const authDeps = {
  getUser: (jwt: string) =>
    Promise.resolve(jwt === 'jwt-admin' ? { id: ADMIN, aal: 'aal2' } : null),
  getProfile: () =>
    Promise.resolve({ role: 'admin' as const, is_active: true, phone: '9647000000001' }),
  touchSession: () => Promise.resolve(true),
};
const resetDeps: ResetPinDeps = {
  ...authDeps,
  rateHit: never,
  updatePassword: never,
  revokeSessions: never,
  recordReset: never,
};
const createDeps: CreateUserDeps = {
  ...authDeps,
  rateHit: never,
  createUser: never,
  finish: never,
  deleteUser: never,
};

const signupDeps: SignupDeps = { rateHit: never, createUser: never };
const deleteDeps: DeleteAccountDeps = {
  getUserId: () => Promise.resolve(null),
  begin: never,
  deleteUser: never,
  abort: never,
};

const SERVERS = [
  ['admin-reset-pin', createResetPinServer(resetDeps, ALLOWED)],
  ['admin-create-user', createAdminCreateUserServer(createDeps, ALLOWED)],
  ['signup', createSignupServer(signupDeps, ALLOWED)],
  ['delete-account', createDeleteAccountServer(deleteDeps, ALLOWED)],
] as const;

/** ما يرسله المتصفح قبل functions.invoke من لوحة على أصل آخر. */
const preflight = (origin: string) =>
  new Request('https://ref.supabase.co/functions/v1/x', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, apikey, content-type, x-client-info',
    },
  });

for (const [name, serve] of SERVERS) {
  Deno.test(
    `${name}: browser preflight from the panel origin → 204 with CORS headers (H1)`,
    async () => {
      for (const origin of [PANEL, DEV_PANEL]) {
        const res = await serve(preflight(origin));
        assert.equal(res.status, 204, `${origin}: not 405 like the hosted bug`);
        assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
        assert.match(res.headers.get('Access-Control-Allow-Methods') ?? '', /POST/);
        const allowedHeaders = res.headers.get('Access-Control-Allow-Headers') ?? '';
        for (const h of ['authorization', 'apikey', 'content-type', 'x-client-info']) {
          assert.ok(allowedHeaders.includes(h), `${h} allowed`);
        }
        assert.match(res.headers.get('Vary') ?? '', /Origin/);
      }
    },
  );

  Deno.test(`${name}: a foreign origin gets no CORS headers (never *)`, async () => {
    for (const origin of ['https://evil.example', 'null', `${PANEL}.evil.example`]) {
      const res = await serve(preflight(origin));
      assert.equal(res.status, 403);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    }
    const post = await serve(
      new Request('https://x', { method: 'POST', headers: { Origin: 'https://evil.example' } }),
    );
    assert.equal(post.headers.get('Access-Control-Allow-Origin'), null);
  });

  Deno.test(
    `${name}: the real response (here 401) carries the CORS header for the panel`,
    async () => {
      // signup بلا JWT: نختبر ردّ 405 الحقيقي (PUT) بدل استدعاء اعتمادية
      const probe = name === 'signup' ? { method: 'PUT' } : { method: 'POST', body: '{}' };
      const res = await serve(new Request('https://x', { ...probe, headers: { Origin: PANEL } }));
      const expected =
        name === 'signup'
          ? { status: 405, body: { error: 'SIGNUP_FAILED' } }
          : { status: 401, body: { error: 'NOT_AUTHENTICATED' } };
      assert.equal(res.status, expected.status); // الرمز يبقى مقروءاً بالمتصفح بفضل CORS
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), PANEL);
      assert.deepEqual(await res.json(), expected.body);
    },
  );

  Deno.test(`${name}: index.ts serves the CORS-wrapped handler with ALLOWED_ORIGINS`, async () => {
    const src = await Deno.readTextFile(new URL(`../${name}/index.ts`, import.meta.url));
    assert.match(src, /Deno\.serve\(\s*create\w+Server\(/);
    assert.match(
      src,
      /allowedOrigins\(\)|parseAllowedOrigins\(Deno\.env\.get\('ALLOWED_ORIGINS'\)\)/,
    );
  });
}

Deno.test('ALLOWED_ORIGINS: empty or unset allows nothing; "*" and junk are ignored', async () => {
  assert.equal(parseAllowedOrigins(undefined).size, 0);
  assert.equal(parseAllowedOrigins('').size, 0);
  assert.deepEqual(
    [
      ...parseAllowedOrigins(
        ' * , not a url, ftp://x.example, https://a.example/path, https://b.example/ ',
      ),
    ],
    ['https://b.example'],
  );
  const closed = createResetPinServer(resetDeps, parseAllowedOrigins(undefined));
  const res = await closed(preflight(PANEL));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

Deno.test('withCors keeps the handler status, body and headers', async () => {
  const wrapped = withCors(
    () => Promise.resolve(new Response('{"ok":true}', { status: 201, headers: { 'X-A': '1' } })),
    ALLOWED,
  );
  const res = await wrapped(
    new Request('https://x', { method: 'POST', headers: { Origin: PANEL } }),
  );
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('X-A'), '1');
  assert.equal(await res.text(), '{"ok":true}');
  assert.ok(CORS_ALLOW_HEADERS.includes('authorization'));
});

Deno.test('jwtAal reads the aal claim (C1)', () => {
  // UTF-8 كما بالرموز الحقيقية (user_metadata قد يحمل نصاً عربياً)
  const b64url = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const jwt = (claims: unknown) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;
  assert.equal(jwtAal(jwt({ sub: ADMIN, aal: 'aal2' })), 'aal2');
  assert.equal(jwtAal(jwt({ sub: ADMIN, aal: 'aal1', name: 'علي؟>' })), 'aal1');
  assert.equal(jwtAal(jwt({ sub: ADMIN })), null);
  assert.equal(jwtAal('not-a-jwt'), null);
  assert.equal(jwtAal('a.!!!.c'), null);
});
