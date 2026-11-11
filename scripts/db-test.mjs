#!/usr/bin/env node
// يشغّل اختبارات pgTAP بـ supabase/tests/NN_*.sql.
//
//   node scripts/db-test.mjs            -> القاعدة المحلية (supabase start)، أو DB_URL إن وُجد
//   node scripts/db-test.mjs --remote   -> المشروع السحابي المربوط (pooler-url + SUPABASE_DB_PASSWORD)
//   node scripts/db-test.mjs 03 05      -> ملفات محددة فقط (بادئة الاسم)
//
// كل ملف يعمل داخل BEGIN ... ROLLBACK: امتداد pgtap والدوال المساعدة (_helpers.sql)
// وبيانات الاختبار كلها تُنشأ داخل المعاملة وتُلغى بنهايتها. لا شيء يبقى بقاعدة البيانات.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(import.meta.dirname, '..');
const testsDir = path.join(root, 'supabase', 'tests');
const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const filters = args.filter((a) => !a.startsWith('--'));

function readPassword() {
  if (process.env.SUPABASE_DB_PASSWORD) return process.env.SUPABASE_DB_PASSWORD;
  const envFile = path.join(root, '.env.local');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^SUPABASE_DB_PASSWORD=(.*)$/m);
    if (m) return m[1].trim();
  }
  throw new Error('SUPABASE_DB_PASSWORD is not set (env or .env.local)');
}

function connectionConfig() {
  if (!remote) return { connectionString: process.env.DB_URL ?? LOCAL_URL };
  const poolerFile = path.join(root, 'supabase', '.temp', 'pooler-url');
  if (!fs.existsSync(poolerFile)) throw new Error('Not linked: run `supabase link` first');
  const url = new URL(fs.readFileSync(poolerFile, 'utf8').trim());
  url.password = readPassword();
  // شهادة الـ pooler موقّعة من "Supabase Root 2021 CA" (غير موجودة بمخزن Node).
  // نتحقق منها بملف الـ CA المنزّل من اللوحة (انظر docs/RUNBOOK.md)، مع تحقق كامل.
  const caFile =
    process.env.SUPABASE_CA_CERT ?? path.join(root, 'supabase', 'certs', 'prod-ca-2021.crt');
  if (!fs.existsSync(caFile)) {
    throw new Error(
      `Supabase CA certificate not found at ${caFile}. Download it from ` +
        'Dashboard > Project Settings > Database > SSL Configuration (see docs/RUNBOOK.md).',
    );
  }
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl: { ca: fs.readFileSync(caFile, 'utf8'), servername: url.hostname },
  };
}

function tapLines(results) {
  const lines = [];
  for (const res of [].concat(results)) {
    for (const row of res.rows ?? []) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string') lines.push(...value.split('\n'));
      }
    }
  }
  return lines;
}

function evaluate(lines) {
  const plan = lines.map((l) => /^1\.\.(\d+)$/.exec(l)).find(Boolean);
  const passed = lines.filter((l) => /^ok \d+/.test(l)).length;
  const failed = lines.filter((l) => /^not ok \d+/.test(l));
  // سطور "not ok" مع تشخيص pgTAP (# ...) الذي يليها
  const problems = failed.length ? lines.filter((l) => /^not ok \d+|^#/.test(l)) : [];
  if (!plan) problems.push('no plan() found');
  else if (Number(plan[1]) !== passed + failed.length)
    problems.push(`planned ${plan[1]} tests but ran ${passed + failed.length}`);
  return { passed, problems };
}

const files = fs
  .readdirSync(testsDir)
  .filter((f) => /^\d\d_.*\.sql$/.test(f))
  .filter((f) => filters.length === 0 || filters.some((p) => f.startsWith(p)))
  .sort();
const helpers = fs.readFileSync(path.join(testsDir, '_helpers.sql'), 'utf8');

const client = new pg.Client(connectionConfig());
await client.connect();
console.log(`target: ${remote ? 'remote (linked project)' : 'local'}\n`);

let total = 0;
let failedFiles = 0;
for (const file of files) {
  const sql = fs.readFileSync(path.join(testsDir, file), 'utf8');
  let outcome;
  try {
    await client.query('begin');
    await client.query('create extension if not exists pgtap with schema extensions');
    await client.query(helpers);
    outcome = evaluate(tapLines(await client.query(sql)));
  } catch (err) {
    outcome = {
      passed: 0,
      problems: [`error: ${err.message}${err.detail ? ` (${err.detail})` : ''}`],
    };
  } finally {
    await client.query('rollback');
  }
  total += outcome.passed;
  if (outcome.problems.length) {
    failedFiles++;
    console.log(`FAIL ${file}`);
    for (const p of outcome.problems) console.log(`     ${p}`);
  } else {
    console.log(`ok   ${file} (${outcome.passed})`);
  }
}
await client.end();

console.log(`\n${files.length - failedFiles}/${files.length} files passed, ${total} assertions ok`);
process.exit(failedFiles || files.length === 0 ? 1 : 0);
