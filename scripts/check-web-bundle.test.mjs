// node --test: فحص bundle الويب من الأسرار (T37، SPEC-webpush §5.1 و§8 البند 12).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { findSecrets, scanDir } from './check-web-bundle.mjs';

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.c2lnbmF0dXJlLXZhbHVl`;

test('literals used to REJECT keys are not findings', () => {
  const code = `if(k.startsWith("sb_secret_"))throw Error("Refusing a service_role/secret key");role==="service_role"`;
  assert.deepEqual(findSecrets(code), []);
});

test('an sb_secret_ key is a finding', () => {
  const found = findSecrets(`const k="sb_secret_AbCdEf0123456789xyzXYZ_-abc";`);
  assert.equal(found.length, 1);
  assert.match(found[0], /sb_secret_ key/);
});

test('a service_role JWT is a finding; an anon JWT is not', () => {
  assert.equal(findSecrets(`key:"${jwt({ role: 'service_role', iss: 'supabase' })}"`).length, 1);
  assert.deepEqual(findSecrets(`key:"${jwt({ role: 'anon', iss: 'supabase' })}"`), []);
  assert.deepEqual(
    findSecrets('eyJhbGciOi.eyJnot-json.x'),
    [],
    'undecodable token-like text is ignored',
  );
});

test('PEM private keys and the VAPID private key name are findings', () => {
  assert.equal(findSecrets('-----BEGIN PRIVATE KEY-----\nMIGH...').length, 1);
  assert.equal(findSecrets('-----BEGIN EC PRIVATE KEY-----').length, 1);
  assert.equal(findSecrets('process.env.VAPID_PRIVATE_KEY').length, 1);
  assert.deepEqual(findSecrets('EXPO_PUBLIC_VAPID_PUBLIC_KEY'), []);
});

test('values of secret env vars set at build time must not appear', () => {
  const env = {
    VAPID_PRIVATE_KEY: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    SUPABASE_SECRET_KEY: '',
  };
  assert.equal(findSecrets('x="q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"', env).length, 1);
  assert.deepEqual(findSecrets('nothing here', env), []);
});

test('findings never print the secret itself', () => {
  const secret = 'sb_secret_AbCdEf0123456789xyzXYZ_-abc';
  for (const f of findSecrets(secret)) assert.ok(!f.includes('AbCdEf0123456789'), f);
});

test('scanDir walks text files recursively and reports file names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  try {
    mkdirSync(join(dir, '_expo', 'js'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, '_expo', 'js', 'a.js'), 'ok');
    writeFileSync(join(dir, '_expo', 'js', 'b.js'), 'k="sb_secret_AbCdEf0123456789xyzXYZ"');
    writeFileSync(join(dir, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const out = scanDir(dir, {});
    assert.equal(out.length, 1);
    assert.match(out[0], /_expo[\\/]js[\\/]b\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
