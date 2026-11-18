import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveImageTarget } from './guard.mjs';

const DEV = 'ghcohlrzvehtcettaaiu';
const PROD = 'abcdefghijklmnopqrst';
const remote = (ref) => ({
  kind: 'remote',
  projectRef: ref,
  poolerUrl: `postgresql://postgres.${ref}:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
});
const lists = { prod: [PROD] };

test('default: dev project is allowed, anything else is refused', () => {
  assert.equal(resolveImageTarget(remote(DEV), [], {}), 'dev');
  assert.throws(() => resolveImageTarget(remote('zzzzzzzzzzzzzzzzzzzz'), [], {}), /Refusing/);
});

test('--target=prod needs --remote, MUKHDAR_TARGET=prod and a matching --confirm-ref', () => {
  const args = ['--remote', '--target=prod'];
  const env = { MUKHDAR_TARGET: 'prod' };
  assert.throws(
    () => resolveImageTarget({ kind: 'local', url: 'x' }, args, env, lists),
    /--remote/,
  );
  assert.throws(() => resolveImageTarget(remote(PROD), args, {}, lists), /MUKHDAR_TARGET/);
  assert.throws(() => resolveImageTarget(remote(PROD), args, env, lists), /confirm-ref/);
  assert.throws(
    () => resolveImageTarget(remote(PROD), [...args, '--confirm-ref=wrong'], env, lists),
    /confirm-ref/,
  );
  assert.equal(
    resolveImageTarget(remote(PROD), [...args, `--confirm-ref=${PROD}`], env, lists),
    'prod',
  );
});

test('--target=prod never accepts the dev project or the placeholder ref', () => {
  const env = { MUKHDAR_TARGET: 'prod' };
  assert.throws(
    () =>
      resolveImageTarget(
        remote(DEV),
        ['--remote', '--target=prod', `--confirm-ref=${DEV}`],
        env,
        lists,
      ),
    /not the known production/,
  );
  const ph = 'REPLACE_WITH_MUKHDAR_PROD_REF';
  assert.throws(
    () =>
      resolveImageTarget(remote(ph), ['--remote', '--target=prod', `--confirm-ref=${ph}`], env, {
        prod: [ph],
      }),
    /not the known production/,
  );
});
