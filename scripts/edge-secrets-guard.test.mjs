// node --test (bug 2026-11-23): `supabase secrets set` (any secret, e.g. the VAPID keys) also pushes
// supabase/config.toml [edge_runtime.secrets] to the linked project. The local ALLOWED_ORIGINS there
// (localhost only) overwrote mukhdar-dev's value, every preflight from the deployed apps got 403, and
// sign-up / delete-account / driver register / admin reset-pin showed "can't connect".
// This guard keeps cloud secrets out of config.toml, and checks the live-check logic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { BROWSER_FUNCTIONS, DEFAULT_ORIGINS, checkCors } from './cors-live-check.mjs';
import { root } from './lib/db.mjs';

const configToml = fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');

test('config.toml has no [edge_runtime.secrets] (secrets set would push it to the remote project)', () => {
  const active = configToml
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
  assert.equal(
    active.some((l) => /^\[\s*edge_runtime\.secrets\s*\]$/.test(l)),
    false,
    'move local function secrets to supabase/functions/.env (from .env.example)',
  );
  assert.equal(
    active.some((l) => /^ALLOWED_ORIGINS\s*=/.test(l)),
    false,
    'ALLOWED_ORIGINS must not be set in config.toml',
  );
});

test('supabase/functions/.env.example keeps the local origins (admin e2e 3100, customer e2e 3000), no cloud origin', () => {
  const env = fs.readFileSync(path.join(root, 'supabase', 'functions', '.env.example'), 'utf8');
  const value = /^ALLOWED_ORIGINS=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
  const origins = value.split(',');
  for (const o of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:3100']) {
    assert.ok(origins.includes(o), `${o} missing`);
  }
  assert.ok(
    origins.every((o) => /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o)),
    value,
  );
});

function fakeFetch(allowed) {
  return async (_url, init) => {
    const origin = init.headers.Origin;
    const ok = allowed.includes(origin);
    return {
      status: ok ? 204 : 403,
      headers: { get: (h) => (ok && h === 'access-control-allow-origin' ? origin : null) },
    };
  };
}

test('checkCors: all deployed origins allowed → every row ok', async () => {
  const rows = await checkCors({ fetchImpl: fakeFetch(DEFAULT_ORIGINS) });
  assert.equal(rows.length, BROWSER_FUNCTIONS.length * DEFAULT_ORIGINS.length);
  assert.ok(rows.every((r) => r.ok));
});

test('checkCors: the 2026-11-23 state (localhost only) fails every deployed origin', async () => {
  const rows = await checkCors({
    fetchImpl: fakeFetch(['http://localhost:3000', 'http://127.0.0.1:3000']),
  });
  assert.ok(rows.every((r) => !r.ok && r.status === 403));
});

test('checkCors: 204 without the echoed origin, or a network error, is a failure', async () => {
  const noEcho = async () => ({ status: 204, headers: { get: () => '*' } });
  const boom = async () => {
    throw new TypeError('fetch failed');
  };
  for (const fetchImpl of [noEcho, boom]) {
    const rows = await checkCors({
      fetchImpl,
      functions: ['signup'],
      origins: [DEFAULT_ORIGINS[0]],
    });
    assert.equal(rows[0].ok, false);
  }
});
