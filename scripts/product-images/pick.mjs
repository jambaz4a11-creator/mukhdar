#!/usr/bin/env node
// يضيف اختيارات إلى manifest.json من مرشحي search.mjs: node scripts/product-images/pick.mjs "طماطة=0" "عنب=4" ...
// (الرقم = ترتيب الصورة بشبكة المعاينة). يستبدل مدخل المنتج إن وُجد. الرخصة تُتحقق مرة ثانية عند run.mjs.
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const manifestPath = path.join(here, 'manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : [];
for (const arg of process.argv.slice(2)) {
  const [product, idx] = arg.split('=');
  const cands = JSON.parse(
    fs.readFileSync(path.join(here, '.cache', 'candidates', `${product}.json`), 'utf8'),
  );
  const c = cands[Number(idx)];
  if (!c) throw new Error(`${product}: no candidate #${idx}`);
  const entry = {
    product,
    source: c.src,
    id: c.id,
    title: c.title,
    landing: c.landing,
    file: c.file,
    license: c.license,
    licenseUrl: c.licenseUrl,
    creator: c.creator,
  };
  const at = manifest.findIndex((m) => m.product === product);
  if (at >= 0) manifest[at] = entry;
  else manifest.push(entry);
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${manifest.length} entries`);
