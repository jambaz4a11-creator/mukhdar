// T23 F H2: الدوال تعمل بالمفاتيح الجديدة (sb_secret_ / sb_publishable_) وبالقديمة، فإطفاء القديمة لا يكسرها.
import assert from 'node:assert/strict';
import { keyKind, namedKey, publishableKey, secretKey, supabaseUrl } from './keys.ts';

const env = (vars: Record<string, string>) => ({ get: (n: string) => vars[n] });
const NEW_SECRET = 'sb_secret_abc123';
const NEW_PUB = 'sb_publishable_xyz789';
const OLD_SERVICE = 'eyJhbGciOiJIUzI1NiJ9.service.sig';
const OLD_ANON = 'eyJhbGciOiJIUzI1NiJ9.anon.sig';

Deno.test('keys: the new keys are preferred when both kinds are injected', () => {
  const e = env({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW_SECRET }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: NEW_PUB }),
    SUPABASE_SERVICE_ROLE_KEY: OLD_SERVICE,
    SUPABASE_ANON_KEY: OLD_ANON,
  });
  assert.equal(secretKey(e), NEW_SECRET);
  assert.equal(publishableKey(e), NEW_PUB);
  assert.equal(keyKind(secretKey(e)), 'new');
});

Deno.test('keys: legacy keys only (before the new keys exist) still work', () => {
  const e = env({ SUPABASE_SERVICE_ROLE_KEY: OLD_SERVICE, SUPABASE_ANON_KEY: OLD_ANON });
  assert.equal(secretKey(e), OLD_SERVICE);
  assert.equal(publishableKey(e), OLD_ANON);
  assert.equal(keyKind(secretKey(e)), 'legacy');
});

Deno.test('keys: new keys only (legacy turned off) work', () => {
  const e = env({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW_SECRET }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: NEW_PUB }),
  });
  assert.equal(secretKey(e), NEW_SECRET);
  assert.equal(publishableKey(e), NEW_PUB);
});

Deno.test('keys: a named key via SUPABASE_KEY_NAME (separate key per backend)', () => {
  const e = env({
    SUPABASE_KEY_NAME: 'functions',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW_SECRET, functions: 'sb_secret_fn' }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: NEW_PUB }),
    SUPABASE_ANON_KEY: OLD_ANON,
  });
  assert.equal(secretKey(e), 'sb_secret_fn');
  // لا مفتاح منشور بذلك الاسم ← القديم
  assert.equal(publishableKey(e), OLD_ANON);
});

Deno.test('keys: malformed JSON or empty values fall back, never crash on parse', () => {
  assert.equal(namedKey('{not json', 'default'), null);
  assert.equal(namedKey('["sb_secret_x"]', 'default'), null);
  assert.equal(namedKey('{"default": 5}', 'default'), null);
  assert.equal(namedKey('{"default": "  "}', 'default'), null);
  assert.equal(namedKey(undefined, 'default'), null);
  assert.equal(
    secretKey(env({ SUPABASE_SECRET_KEYS: '{oops', SUPABASE_SERVICE_ROLE_KEY: OLD_SERVICE })),
    OLD_SERVICE,
  );
});

Deno.test('keys: nothing injected → a clear error without any key value', () => {
  assert.throws(() => secretKey(env({})), /No Supabase secret key/);
  assert.throws(() => publishableKey(env({})), /No Supabase publishable key/);
  assert.throws(() => supabaseUrl(env({})), /SUPABASE_URL missing/);
  assert.equal(
    supabaseUrl(env({ SUPABASE_URL: 'https://x.supabase.co' })),
    'https://x.supabase.co',
  );
});
