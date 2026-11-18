#!/usr/bin/env node
// أداة بحث عن مرشحين لصور المنتجات (تُشغَّل يدوياً، لا تكتب شيئاً بقاعدة البيانات): تبحث بـ Openverse (رخصة cc0 أو
// pdm فقط) وويكيميديا كومنز (رخصة CC0 / ملكية عامة فقط)، وترتّب بأبيض الحواف (صورة منتج على خلفية بيضاء/سادة)،
// وتكتب JSON وشبكات معاينة (contact sheets) بمجلد الإخراج لاختيار الصور بالعين. الاختيار النهائي يُكتب بـ manifest.json.
//   node scripts/product-images/search.mjs [outDir] [--only=<arabic name>]   (الافتراضي: scripts/product-images/.cache/candidates، مُتجاهَل بـ git)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const UA = 'mukhdar-product-images/1.0 (catalog tooling)';
const outDir =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ??
  path.join(import.meta.dirname, '.cache', 'candidates');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
fs.mkdirSync(outDir, { recursive: true });
const queries = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'queries.json'), 'utf8'));

const get = async (url, as = 'json') => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status === 429) {
      await new Promise((s) => setTimeout(s, 3000 * (i + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return as === 'json' ? r.json() : Buffer.from(await r.arrayBuffer());
  }
  throw new Error(`rate limited ${url}`);
};

async function openverse(q) {
  const out = [];
  for (const term of [`${q} white background`, q]) {
    const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&license=cc0,pdm&category=photograph&page_size=20`;
    try {
      for (const r of (await get(u)).results) {
        out.push({
          src: 'openverse',
          id: r.id,
          title: r.title,
          license: r.license,
          licenseUrl: r.license_url,
          landing: r.foreign_landing_url,
          file: r.url,
          thumb: `https://api.openverse.org/v1/images/${r.id}/thumb/`,
          creator: r.creator,
        });
      }
    } catch (e) {
      console.warn('openverse', term, e.message);
    }
  }
  return out;
}

const OK_LICENSE = /^(cc0|cc zero|public domain|pd[- ]|pdm)/i;
async function commons(q) {
  const out = [];
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(`${q} isolated white background`)}&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=256`;
  try {
    const j = await get(u);
    for (const p of Object.values(j.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      const lic = ii?.extmetadata?.LicenseShortName?.value ?? '';
      if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime) || !OK_LICENSE.test(lic)) continue;
      out.push({
        src: 'commons',
        id: p.title,
        title: p.title,
        license: lic,
        licenseUrl: ii.extmetadata?.LicenseUrl?.value ?? '',
        landing: ii.descriptionurl,
        file: ii.url,
        thumb: ii.thumburl,
        creator: (ii.extmetadata?.Artist?.value ?? '').replace(/<[^>]+>/g, ''),
      });
    }
  } catch (e) {
    console.warn('commons', q, e.message);
  }
  return out;
}

/** أبيض الحواف 0..1 (حافة 8%): الصورة المنتجية على خلفية بيضاء تقترب من 1. */
async function whiteScore(buf) {
  const { data, info } = await sharp(buf)
    .resize(64, 64, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let white = 0,
    n = 0;
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      if (x > 5 && x < 58 && y > 5 && y < 58) continue;
      const i = (y * 64 + x) * info.channels;
      n++;
      if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) white++;
    }
  return white / n;
}

const names = Object.keys(queries).filter((n) => !only || n === only);
for (const name of names) {
  const q = process.argv.find((a) => a.startsWith('--q='))?.slice(4) ?? queries[name]; // --q= مع --only: استعلام بديل
  if (fs.existsSync(path.join(outDir, `${name}.json`)) && !process.argv.includes('--force'))
    continue; // استئناف
  const seen = new Set();
  const cands = [];
  for (const c of [...(await commons(q)), ...(await openverse(q))]) {
    if (seen.has(c.file)) continue;
    seen.add(c.file);
    try {
      c.white = await whiteScore(await get(c.thumb, 'buf'));
      c.buf = null;
    } catch {
      continue;
    }
    cands.push(c);
  }
  cands.sort((a, b) => b.white - a.white);
  const top = cands.slice(0, 8);
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(top, null, 1));
  const tiles = [];
  for (const [i, c] of top.entries()) {
    const buf = await sharp(await get(c.thumb, 'buf'))
      .resize(200, 200, { fit: 'cover' })
      .png()
      .toBuffer();
    const label = Buffer.from(
      `<svg width="200" height="26"><rect width="200" height="26" fill="#000" opacity=".7"/><text x="6" y="19" font-size="18" fill="#fff" font-family="Arial">${i} ${c.src[0]} ${(c.white * 100) | 0}%</text></svg>`,
    );
    tiles.push({
      input: await sharp(buf)
        .composite([{ input: label, top: 0, left: 0 }])
        .png()
        .toBuffer(),
      left: (i % 4) * 204,
      top: Math.floor(i / 4) * 204,
    });
  }
  if (tiles.length)
    await sharp({ create: { width: 816, height: 408, channels: 3, background: '#888' } })
      .composite(tiles)
      .png()
      .toFile(path.join(outDir, `${name}.png`));
  console.log(
    name,
    `${q}: ${cands.length} candidates, ${top.filter((c) => c.white > 0.6).length} white-bg`,
  );
}
