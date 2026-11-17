// node --test (T23 H3): seed:demo وseed:reset يرفضان أي مشروع غير التطوير **كعملية حقيقية** (لا دالة فقط):
// مشروع مربوط مزيف عبر MUKHDAR_SUPABASE_TEMP، ثم يجب أن تخرج العملية بخطأ "Refusing" قبل أي اتصال.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { root } from './lib/db.mjs';
import { DEV_PROJECT_REFS, PROD_PROJECT_REFS } from './lib/projects.mjs';

const DEV = DEV_PROJECT_REFS[0];
const pooler = (ref) =>
  `postgresql://postgres.${ref}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`;

function fakeLink(ref, poolerRef = ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mukhdar-guard-'));
  fs.writeFileSync(path.join(dir, 'project-ref'), ref);
  fs.writeFileSync(path.join(dir, 'pooler-url'), pooler(poolerRef));
  return dir;
}

function run(script, args, env) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    env: {
      ...process.env,
      // لا كلمة سر: لو تجاوز الحارس لفشل الاتصال برسالة أخرى، والاختبار يطلب "Refusing" تحديداً
      SUPABASE_DB_PASSWORD: '',
      DB_URL: '',
      MUKHDAR_ENV: '',
      ...env,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const CASES = [
  [
    'the production project (the registered prod ref)',
    () => fakeLink(PROD_PROJECT_REFS[0]),
    /PRODUCTION project/,
  ],
  ['an unknown project', () => fakeLink('someotherprojectrefx'), /not a known development project/],
  [
    'dev project-ref but a pooler URL of another project',
    () => fakeLink(DEV, 'someotherprojectrefx'),
    /pooler URL points to/,
  ],
];

for (const script of ['seed-demo.mjs', 'seed-reset.mjs']) {
  for (const [name, link, why] of CASES) {
    test(`${script} --remote refuses ${name}`, () => {
      const dir = link();
      try {
        const r = run(script, ['--remote'], { MUKHDAR_SUPABASE_TEMP: dir });
        assert.notEqual(r.code, 0, r.out);
        assert.match(r.out, /Refusing/);
        assert.match(r.out, why);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test(`${script} refuses MUKHDAR_ENV=production and a non-local DB_URL`, () => {
    const prodEnv = run(script, [], { MUKHDAR_ENV: 'production' });
    assert.notEqual(prodEnv.code, 0);
    assert.match(prodEnv.out, /Refusing: MUKHDAR_ENV is production/);
    const remoteUrl = run(script, [], {
      DB_URL: `postgresql://postgres:x@db.${DEV}.supabase.co:5432/postgres`,
    });
    assert.notEqual(remoteUrl.code, 0);
    assert.match(remoteUrl.out, /Refusing: DB_URL host .* is not local/);
  });
}
