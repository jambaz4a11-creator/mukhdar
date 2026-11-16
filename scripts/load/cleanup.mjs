#!/usr/bin/env node
// T22: تنظيف يدوي لبيانات اختبار الحمل (إن انقطع run.mjs). آمن لإعادة التشغيل. mukhdar-dev فقط.
//   pnpm load:cleanup
// يعيد إعدادات المتجر من scripts/load/.run/before.json إن وُجد، ويحذف كل ما بادئته 9647006 / LOADTEST،
// ثم يتحقق من صفر مخلّفات.
import { assertSafeTarget, connect, resolveTarget } from '../lib/db.mjs';
import { loadEnv } from './lib.mjs';
import { cleanup, loadBefore, verifyClean } from './state.mjs';

const env = loadEnv();
const target = resolveTarget(['--remote']);
assertSafeTarget(target);
const db = await connect(target);
const before = loadBefore();
if (!before)
  console.log(
    'note: no before.json snapshot; deleting by name/prefix only (settings are not touched).',
  );
try {
  await cleanup(db, env, before);
  const problems = await verifyClean(db, before);
  if (problems.length) {
    problems.forEach((p) => console.error(`FAIL  ${p}`));
    process.exitCode = 1;
  } else {
    console.log('ok    zero leftovers');
  }
} finally {
  await db.end();
}
