/* global Buffer, console */
// يولّد كل أيقونات التطبيقات من SVG المصدر بهذا المجلد (شعار مؤقت، T45). النص محوَّل لمسارات فلا اعتماد على خط.
// الاستخدام: pnpm brand:icons   (يُبدَّل المصدر لاحقاً بالشعار الحقيقي ثم يُعاد التشغيل)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (n) => readFileSync(join(root, 'branding', n));
const GREEN = '#1F6B3A';

const icon = src('logo-icon.svg');
const fg = src('logo-foreground.svg');
const mono = src('logo-monochrome.svg');
const splash = src('logo-splash.svg');

// أيقونة بزوايا مدوّرة (any purpose + favicon): الـ SVG الكامل داخل مستطيل مدوّر
const rounded = Buffer.from(
  icon
    .toString()
    .replace(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><clipPath id="r"><rect width="1024" height="1024" rx="224"/></clipPath><g clip-path="url(#r)">',
    )
    .replace('</svg>', '</g></svg>'),
);

const png = async (buf, size, out) => {
  mkdirSync(dirname(out), { recursive: true });
  await sharp(buf, { density: 384 }).resize(size, size).png().toFile(out);
};

for (const app of ['customer', 'driver']) {
  const a = join(root, 'apps', app, 'assets', 'images');
  await png(icon, 1024, join(a, 'icon.png'));
  await png(fg, 512, join(a, 'android-icon-foreground.png'));
  await png(mono, 432, join(a, 'android-icon-monochrome.png'));
  await sharp({ create: { width: 512, height: 512, channels: 3, background: GREEN } })
    .png()
    .toFile(join(a, 'android-icon-background.png'));
  await png(rounded, 48, join(a, 'favicon.png'));
  // splash: النص الأخضر فقط، مقصوص على حدوده، عرض 228 (يُعرض على خلفية كريمية)
  const sp = await sharp(splash, { density: 384 })
    .resize(1024, 1024)
    .trim()
    .resize({ width: 228 })
    .png()
    .toBuffer();
  writeFileSync(join(a, 'splash-icon.png'), sp);
}

for (const app of ['customer', 'driver', 'admin']) {
  const p = join(root, 'apps', app, 'public', 'icons');
  await png(icon, 180, join(p, 'apple-touch-icon.png'));
  await png(rounded, 192, join(p, 'icon-192.png'));
  await png(rounded, 512, join(p, 'icon-512.png'));
  await png(icon, 512, join(p, 'icon-maskable-512.png'));
  if (app !== 'admin') await png(rounded, 48, join(p, 'favicon.png'));
}

// favicon اللوحة (Next app/icon.svg)
writeFileSync(join(root, 'apps/admin/src/app/icon.svg'), rounded);
console.log('icons generated');
