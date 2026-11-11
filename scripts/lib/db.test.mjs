// node --test: حماية سكربتات البيانات التجريبية من الكتابة على غير التطوير (T05)
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeTarget, resolveTarget, DEV_PROJECT_REFS, LOCAL_URL } from './db.mjs';

const devRef = DEV_PROJECT_REFS[0];
const remote = (projectRef) => ({
  kind: 'remote',
  projectRef,
  poolerUrl: 'postgresql://x@h:5432/postgres',
});
const local = (url) => ({ kind: 'local', url });

test('allows the linked dev project', () => {
  assert.doesNotThrow(() => assertSafeTarget(remote(devRef), {}));
});

test('allows the local stack', () => {
  assert.doesNotThrow(() => assertSafeTarget(local(LOCAL_URL), {}));
  assert.doesNotThrow(() =>
    assertSafeTarget(local('postgresql://postgres:postgres@localhost:54322/postgres'), {}),
  );
});

test('refuses any other linked project (e.g. production)', () => {
  assert.throws(
    () => assertSafeTarget(remote('prodprojectref123456'), {}),
    /not a known development project/,
  );
});

test('refuses when no project is linked', () => {
  assert.throws(() => assertSafeTarget(remote(undefined), {}), /no linked project/);
});

test('refuses when MUKHDAR_ENV=production, even for the dev project or local', () => {
  assert.throws(
    () => assertSafeTarget(remote(devRef), { MUKHDAR_ENV: 'production' }),
    /production/,
  );
  assert.throws(() => assertSafeTarget(local(LOCAL_URL), { MUKHDAR_ENV: 'PROD' }), /production/);
});

test('refuses a non-local DB_URL', () => {
  assert.throws(
    () =>
      assertSafeTarget(
        local('postgresql://postgres:x@db.abcdefghijklmnop.supabase.co:5432/postgres'),
        {},
      ),
    /not local/,
  );
});

test('resolveTarget defaults to local and honours DB_URL', () => {
  assert.deepEqual(resolveTarget([], {}), { kind: 'local', url: LOCAL_URL });
  assert.equal(
    resolveTarget([], { DB_URL: 'postgresql://a@127.0.0.1:1/b' }).url,
    'postgresql://a@127.0.0.1:1/b',
  );
  assert.equal(resolveTarget(['--remote'], {}).kind, 'remote');
});
