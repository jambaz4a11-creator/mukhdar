#!/usr/bin/env node
// يشغّل اختبارات pgTAP بـ supabase/tests/NN_*.sql.
//
//   node scripts/db-test.mjs            -> القاعدة المحلية (supabase start)، أو DB_URL إن وُجد
//   node scripts/db-test.mjs --remote   -> المشروع السحابي المربوط (pooler-url + SUPABASE_DB_PASSWORD)
//   node scripts/db-test.mjs 03 05      -> ملفات محددة فقط (بادئة الاسم)
//   node scripts/db-test.mjs --remote --prelude=supabase/migrations/X.sql
//                                       -> ينفّذ migration غير مطبّقة داخل معاملة كل ملف قبل الاختبار
//                                          (تُلغى مع ROLLBACK): فحص migration جديدة بلا تطبيقها على السحابة
//
// كل ملف يعمل داخل BEGIN ... ROLLBACK: امتداد pgtap والدوال المساعدة (_helpers.sql)
// وبيانات الاختبار كلها تُنشأ داخل المعاملة وتُلغى بنهايتها. لا شيء يبقى بقاعدة البيانات.
import fs from 'node:fs';
import path from 'node:path';
import { connect, describe, resolveTarget, root } from './lib/db.mjs';

const testsDir = path.join(root, 'supabase', 'tests');
const args = process.argv.slice(2);
const target = resolveTarget(args);
const filters = args.filter((a) => !a.startsWith('--'));
const preludeArg = args.find((a) => a.startsWith('--prelude='));
const preludePath = preludeArg ? preludeArg.slice('--prelude='.length) : null;
const prelude = preludePath ? fs.readFileSync(path.resolve(root, preludePath), 'utf8') : null;

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

const client = await connect(target);
console.log(`target: ${describe(target)}${preludePath ? ` (+ ${preludePath}, rolled back)` : ''}
`);

let total = 0;
let failedFiles = 0;
for (const file of files) {
  const sql = fs.readFileSync(path.join(testsDir, file), 'utf8');
  let outcome;
  try {
    await client.query('begin');
    if (prelude) await client.query(prelude);
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
