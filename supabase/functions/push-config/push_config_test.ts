import * as assert from 'node:assert/strict';
import { createPushConfigServer, publicKeyOrNull } from './handler.ts';

// مفتاح عام مثال (web-push README؛ نفس قيمة CI) ومفتاح خاص مثال بطول 43
const PUBLIC =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const PRIVATE_LIKE = 'k'.repeat(43); // طول المفتاح الخاص (32 بايتاً base64url)؛ قيمة وهمية
const ORIGIN = 'https://mukhdar-admin.example.workers.dev';
const allowed = new Set([ORIGIN]);
const post = (origin: string | null = ORIGIN, method = 'POST') =>
  new Request('http://localhost/push-config', {
    method,
    headers: origin ? { origin } : {},
  });

Deno.test('push-config: returns the public key with CORS and a public cache header', async () => {
  const res = await createPushConfigServer(PUBLIC, allowed)(post());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { vapid_public_key: PUBLIC });
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
});

Deno.test('push-config: padding and spaces are trimmed', () => {
  assert.equal(publicKeyOrNull(` ${PUBLIC}= `), PUBLIC);
});

Deno.test(
  'push-config: unset or malformed key -> 503 NOT_CONFIGURED, never echoes the value',
  async () => {
    for (const raw of [
      undefined,
      '',
      'not-a-key',
      PRIVATE_LIKE,
      PUBLIC.slice(1),
      `A${PUBLIC.slice(1)}`,
    ]) {
      const res = await createPushConfigServer(raw, allowed)(post());
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { error: 'NOT_CONFIGURED' });
      if (raw) assert.ok(!text.includes(raw), 'the configured value must not leak');
    }
  },
);

Deno.test('push-config: preflight from an allowed origin 204, foreign origin 403', async () => {
  const server = createPushConfigServer(PUBLIC, allowed);
  assert.equal((await server(post(ORIGIN, 'OPTIONS'))).status, 204);
  assert.equal((await server(post('https://evil.example', 'OPTIONS'))).status, 403);
  const foreign = await server(post('https://evil.example'));
  assert.equal(foreign.status, 403);
  assert.ok(!(await foreign.text()).includes(PUBLIC));
});

Deno.test('push-config: GET -> 405; no Origin (script) still works', async () => {
  const server = createPushConfigServer(PUBLIC, allowed);
  assert.equal((await server(post(ORIGIN, 'GET'))).status, 405);
  assert.equal((await server(post(null))).status, 200);
});
