#!/usr/bin/env node
// يضع صور منتجات حقيقية (ملكية عامة/CC0 فقط) من manifest.json:
//   لكل منتج: يتحقق من الرخصة من المصدر مباشرة (Openverse أو Commons) ← ينزّل ← مربع 800×800 WebP < 200KB
//   ← يرفع لـ product-images/<product_id>/<timestamp>.webp (نفس مسار لوحة الأدمن) ← يضبط products.image_path.
// لا يغيّر الاسم ولا السعر ولا الرصيد ولا القسم. الافتراضي معاينة (تُكتب الصور المعالجة بـ .cache/processed ولا شي آخر).
//
//   node scripts/product-images/run.mjs --remote                 معاينة على mukhdar-dev
//   node scripts/product-images/run.mjs --remote --apply         تنفيذ على mukhdar-dev
//   node scripts/product-images/run.mjs --docs                   يعيد توليد docs/product-images-sources.md من manifest
//   خيارات: --only=<اسم المنتج> --force (يستبدل صورة حقيقية موجودة)
// الإنتاج: يُرفض ما لم يُستهدف صراحة (guard.mjs: --target=prod + MUKHDAR_TARGET=prod + --confirm-ref).
import fs from 'node:fs';
import path from 'node:path';
import { connect, connectDev, describe, readEnvLocal, resolveTarget, root } from '../lib/db.mjs';
import { resolveImageTarget } from './guard.mjs';
import { processProductImage } from './process.mjs';
import { UA, sourcesMarkdown, verifyLicense } from './sources.mjs';

const BUCKET = 'product-images';
const here = import.meta.dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const args = process.argv.slice(2);

if (args.includes('--docs')) {
  fs.writeFileSync(path.join(root, 'docs', 'product-images-sources.md'), sourcesMarkdown(manifest));
  console.log(`docs/product-images-sources.md written (${manifest.length} images)`);
  process.exit(0);
}

const apply = args.includes('--apply');
const force = args.includes('--force');
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const target = resolveTarget(args);
const kind = resolveImageTarget(target, args);
const client = kind === 'dev' ? await connectDev(target) : await connect(target);
const key = readEnvLocal('SUPABASE_SERVICE_ROLE_KEY');
if (apply && !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set (env or .env.local)');
const apiUrl =
  target.kind === 'remote'
    ? `https://${target.projectRef}.supabase.co`
    : (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321');
const processedDir = path.join(here, '.cache', 'processed');
fs.mkdirSync(processedDir, { recursive: true });

console.log(`${apply ? 'APPLY' : 'DRY RUN'} (${kind}) on ${describe(target)}`);
let done = 0;
const problems = [];
try {
  for (const e of manifest) {
    if (only && e.product !== only) continue;
    const { rows } = await client.query(
      'select id, name, image_path from public.products where name = $1',
      [e.product],
    );
    if (rows.length !== 1) {
      problems.push(`${e.product}: ${rows.length} products with this name`);
      continue;
    }
    const p = rows[0];
    if (p.image_path && !p.image_path.startsWith('demo/') && !force) {
      console.log(`skip   ${e.product}: already has a real image (${p.image_path})`);
      continue;
    }
    try {
      const license = await verifyLicense(e);
      const res = await fetch(e.file, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const out = await processProductImage(Buffer.from(await res.arrayBuffer()));
      fs.writeFileSync(path.join(processedDir, `${e.product}.webp`), out.buffer);
      let note = 'preview';
      if (apply) {
        const objectPath = `${p.id}/${Date.now()}.webp`;
        const up = await fetch(`${apiUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'image/webp' },
          body: out.buffer,
        });
        if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);
        await client.query('update public.products set image_path = $1 where id = $2', [
          objectPath,
          p.id,
        ]);
        note = objectPath;
      }
      console.log(
        `ok     ${e.product}: ${license}, ${(out.buffer.length / 1024).toFixed(0)}KB q${out.quality} → ${note}`,
      );
      done++;
    } catch (err) {
      problems.push(`${e.product}: ${err.message}`);
    }
  }
} finally {
  await client.end();
}
console.log(`${done} images ${apply ? 'set' : 'processed (dry run)'}`);
if (problems.length) {
  console.error(`PROBLEMS:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
}
