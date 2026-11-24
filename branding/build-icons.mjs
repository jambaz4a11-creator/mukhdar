/* global Buffer, console */
// يولّد كل أيقونات التطبيقات وأصول المقدمة من الشعار الحقيقي branding/logo.png (T46).
// الاستخدام: pnpm brand:icons   (لتبديل الشعار: استبدل branding/logo.png ثم أعد التشغيل)
// الشعار نقطي (1024) ولم يُتتبَّع لـ SVG لأن التتبع التلقائي بألوان متعددة يشوّه الحواف؛ الأصول المشتقة تُولَّد منه بشفافية نظيفة.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BG = { r: 247, g: 248, b: 243 }; // #F7F8F3 = خلفية الشعار الأصلية = خلفية التطبيق
const N = 1024;

// 1) إزالة الخلفية بمَطّ صحيح (alpha من البعد عن لون الخلفية + استعادة اللون الأصلي للحواف)
const { data: raw } = await sharp(readFileSync(join(root, 'branding/logo.png')))
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const rgba = Buffer.alloc(N * N * 4);
for (let i = 0; i < N * N; i++) {
  const c = [raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]];
  const d = Math.max(Math.abs(c[0] - BG.r), Math.abs(c[1] - BG.g), Math.abs(c[2] - BG.b));
  const a = Math.min(1, Math.max(0, (d - 3) / 40));
  const bgc = [BG.r, BG.g, BG.b];
  for (let k = 0; k < 3; k++) {
    rgba[i * 4 + k] = a > 0 ? Math.max(0, Math.min(255, Math.round((c[k] - bgc[k] * (1 - a)) / a))) : 0;
  }
  rgba[i * 4 + 3] = Math.round(a * 255);
}
const full = await sharp(rgba, { raw: { width: N, height: N, channels: 4 } }).png().toBuffer();

// خطوط السرعة (يسار العربة) وحدها، والعربة بدونها
const LINES = { left: 120, top: 500, width: 280, height: 205 };
const lines = await sharp(full).extract(LINES).png().toBuffer();
const cartRgba = Buffer.from(rgba);
for (let y = LINES.top; y < LINES.top + LINES.height; y++)
  for (let x = LINES.left; x < LINES.left + LINES.width; x++) cartRgba[(y * N + x) * 4 + 3] = 0;
const cart = await sharp(cartRgba, { raw: { width: N, height: N, channels: 4 } }).png().toBuffer();

// 2) مربع حول مركز المحتوى بضلع S على الخلفية الكريمية (يمتد بالخلفية إن زاد عن المصدر)
const CART_C = { x: 547, y: 520 }; // مركز العربة (x 195..900، y 232..812)
const FULL_C = { x: 515, y: 520 }; // مركز الشعار الكامل مع الخطوط (x 130..900)
const framed = async (layer, c, S, size, transparent = false) => {
  const half = S / 2;
  const L = Math.round(c.x - half);
  const T = Math.round(c.y - half);
  // مساحة عمل أكبر من S لتحمّل الامتداد خارج الصورة
  const pad = Math.max(0, -L, -T, L + S - N, T + S - N);
  const padded = await sharp(layer)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const base = await sharp(padded)
    .extract({ left: L + pad, top: T + pad, width: S, height: S })
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  if (transparent) return base;
  return sharp({ create: { width: size, height: size, channels: 4, background: { ...BG, alpha: 1 } } })
    .composite([{ input: base }])
    .png()
    .toBuffer();
};
const roundMask = (size, r) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}"/></svg>`);
const rounded = async (buf, size) =>
  sharp(buf)
    .composite([{ input: roundMask(size, Math.round(size * 0.22)), blend: 'dest-in' }])
    .png()
    .toBuffer();
const write = (buf, out) => {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
};

// قناع أبيض للعربة (أيقونة أحادية للإشعارات وAndroid)
const silhouette = async (S, size) => {
  const g = await framed(cart, CART_C, S, size, true);
  const { data, info } = await sharp(g).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < info.width * info.height; i++) {
    // الثقوب البيضاء بين الثمار تبقى شفافة؛ بقية المحتوى أبيض كامل
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
  }
  return sharp(data, { raw: info }).png().toBuffer();
};

// بلا خطوط، يملأ الإطار (الأحجام الصغيرة): العربة 715 عرضاً داخل ضلع 800
const small = (size) => framed(cart, CART_C, 800, size);
const iconFull = (size) => framed(full, FULL_C, 900, size); // الأيقونة الكبيرة والـ splash (بخطوط السرعة)

for (const app of ['customer', 'driver']) {
  const a = join(root, 'apps', app, 'assets', 'images');
  write(await iconFull(1024), join(a, 'icon.png'));
  // Android adaptive: المنطقة الآمنة 66% من 108dp
  write(await framed(cart, CART_C, 1400, 512, true), join(a, 'android-icon-foreground.png'));
  write(await silhouette(1400, 432), join(a, 'android-icon-monochrome.png'));
  write(
    await sharp({ create: { width: 512, height: 512, channels: 3, background: BG } }).png().toBuffer(),
    join(a, 'android-icon-background.png'),
  );
  write(await rounded(await small(48), 48), join(a, 'favicon.png'));
  // splash الأصلي: الشعار الكامل شفاف (يُعرض على خلفية التطبيق)
  write(await framed(full, FULL_C, 900, 600, true), join(a, 'splash-icon.png'));
}

for (const app of ['customer', 'driver', 'admin']) {
  const p = join(root, 'apps', app, 'public', 'icons');
  write(await small(180), join(p, 'apple-touch-icon.png'));
  write(await rounded(await small(192), 192), join(p, 'icon-192.png'));
  write(await rounded(await small(512), 512), join(p, 'icon-512.png'));
  write(await framed(cart, CART_C, 1160, 512), join(p, 'icon-maskable-512.png'));
  write(await silhouette(900, 96), join(p, 'badge-96.png')); // شارة إشعارات Android (أبيض شفاف)
  if (app !== 'admin') write(await rounded(await small(48), 48), join(p, 'favicon.png'));
}

// favicon اللوحة (Next app/icon.png)
write(await rounded(await small(96), 96), join(root, 'apps/admin/src/app/icon.png'));

// مقدمة الزبون: عربة + خطوط (شفافة، تُحرَّك بالكود)
const ia = join(root, 'apps/customer/assets/intro');
write(await sharp(cart).extract({ left: 190, top: 225, width: 720, height: 600 }).resize({ width: 720 }).png().toBuffer(), join(ia, 'intro-cart.png'));
write(lines, join(ia, 'intro-lines.png'));
console.log('icons generated');
