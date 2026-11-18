// معالجة صورة منتج: مربع 800×800 WebP أقل من 200KB (نفس حد لوحة الأدمن: PRODUCT_IMAGE بـ apps/admin/.../image.ts).
import sharp from 'sharp';

export const SIZE = 800;
export const MAX_BYTES = 200 * 1024;
const QUALITIES = [82, 74, 66, 58, 50, 42];

/** نسبة بكسلات الحافة (8%) القريبة من الأبيض: صورة على خلفية بيضاء تقترب من 1. */
export async function whiteBorderRatio(input) {
  const { data, info } = await sharp(input)
    .rotate()
    .resize(64, 64, { fit: 'fill' })
    .flatten({ background: '#fff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let white = 0;
  let n = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (x > 5 && x < 58 && y > 5 && y < 58) continue;
      const i = (y * 64 + x) * info.channels;
      n++;
      if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) white++;
    }
  }
  return white / n;
}

/** متوسط ألوان الزوايا الأربع (خلفية "شبه بيضاء" غير نقية): لحشو المربع بلون الخلفية نفسه بلا شريط ظاهر. */
async function cornerColor(input) {
  const { data } = await sharp(input)
    .rotate()
    .resize(16, 16, { fit: 'fill' })
    .flatten({ background: '#fff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = [0, 15, 240, 255].map((p) => [data[p * 3], data[p * 3 + 1], data[p * 3 + 2]]);
  const avg = [0, 1, 2].map((c) => Math.round(px.reduce((a, v) => a + v[c], 0) / 4));
  return { r: avg[0], g: avg[1], b: avg[2], alpha: 1 };
}

/**
 * قص مربع: قريبة من المربع ← قص بالتركيز على المهم؛ مستطيلة بخلفية بيضاء ← تُوضع كاملة على مربع أبيض بلا قص
 * (لا يُقطع المنتج)؛ غير ذلك ← قص بالتركيز. ثم WebP بأعلى جودة تحقق الحد.
 */
export async function processProductImage(input) {
  const img = sharp(input).rotate();
  const { width, height } = await img.metadata();
  if (!width || !height) throw new Error('unreadable image');
  const ratio = width / height;
  const white = await whiteBorderRatio(input);
  const wideOnWhite = (ratio < 0.8 || ratio > 1.25) && white > 0.85;
  const base = wideOnWhite
    ? img.resize(SIZE, SIZE, { fit: 'contain', background: await cornerColor(input) })
    : img.resize(SIZE, SIZE, { fit: 'cover', position: 'attention' });
  const flat = await base.flatten({ background: '#ffffff' }).toBuffer();
  for (const quality of QUALITIES) {
    const out = await sharp(flat).webp({ quality }).toBuffer();
    if (out.length <= MAX_BYTES) return { buffer: out, quality, width: SIZE, height: SIZE };
  }
  const out = await sharp(flat).resize(640, 640).webp({ quality: 40 }).toBuffer();
  if (out.length > MAX_BYTES) throw new Error('IMAGE_TOO_COMPLEX');
  return { buffer: out, quality: 40, width: 640, height: 640 };
}
