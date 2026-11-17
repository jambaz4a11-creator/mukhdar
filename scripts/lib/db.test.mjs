// node --test: حماية سكربتات البيانات التجريبية من الكتابة على غير التطوير (T05)
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeTarget, resolveTarget, DEV_PROJECT_REFS, LOCAL_URL } from './db.mjs';
import { PROD_PROJECT_REFS, assertDisjoint, classifyRef, refFromPoolerUrl } from './projects.mjs';

const devRef = DEV_PROJECT_REFS[0];
const remote = (projectRef) => ({
  kind: 'remote',
  projectRef,
  poolerUrl: `postgresql://postgres.${projectRef}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`,
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

// ---------------------------------------------------------------- T23 H3
const PROD = 'prodprojectrefabcdef'; // ref إنتاج صالح الشكل (للاختبار فقط)

test('H3: the dev and prod lists are disjoint (the prod ref is never a dev ref)', () => {
  assert.doesNotThrow(() => assertDisjoint());
  for (const r of PROD_PROJECT_REFS) assert.ok(!DEV_PROJECT_REFS.includes(r));
  assert.throws(() => assertDisjoint([devRef, PROD], [PROD]), /BOTH a dev and a production/);
});

test('H3: a production ref is refused even if someone adds it to the dev allowlist', () => {
  const lists = { dev: [devRef, PROD], prod: [PROD] };
  assert.throws(() => assertSafeTarget(remote(PROD), {}, lists), /PRODUCTION project/);
  assert.equal(classifyRef(PROD, lists.dev, lists.prod), 'prod');
  // ref الإنتاج المحجوز الحالي (placeholder) يُرفض كذلك
  assert.throws(() => assertSafeTarget(remote(PROD_PROJECT_REFS[0]), {}), /PRODUCTION project/);
});

test('H3: a dev project-ref with a pooler URL of another project is refused', () => {
  const t = { ...remote(devRef), poolerUrl: remote(PROD).poolerUrl };
  assert.throws(
    () => assertSafeTarget(t, {}, { dev: [devRef], prod: [PROD] }),
    /PRODUCTION project/,
  );
  const other = { ...remote(devRef), poolerUrl: remote('otherprojectrefabcde').poolerUrl };
  assert.throws(() => assertSafeTarget(other, {}), /pooler URL points to otherprojectrefabcde/);
});

test('refFromPoolerUrl reads postgres.<ref> or db.<ref>.supabase.co', () => {
  assert.equal(refFromPoolerUrl(remote(devRef).poolerUrl), devRef);
  assert.equal(
    refFromPoolerUrl(`postgresql://postgres@db.${devRef}.supabase.co:5432/postgres`),
    devRef,
  );
  assert.equal(refFromPoolerUrl('postgresql://x@h:5432/postgres'), null);
  assert.equal(refFromPoolerUrl(undefined), null);
});
