// تصغير الصور بالمتصفح قبل الرفع (SPEC-admin §2.2): WebP، المنتج 800px و< 200KB، القسم 400px و< 100KB.
// المسارات: product-images/<product_id>/<timestamp>.webp و product-images/categories/<category_id>/<timestamp>.webp.
import type { MukhdarClient } from '@mukhdar/shared';

export const IMAGE_BUCKET = 'product-images';

export interface ImageLimits {
  maxSide: number;
  maxBytes: number;
}
export const PRODUCT_IMAGE: ImageLimits = { maxSide: 800, maxBytes: 200 * 1024 };
export const CATEGORY_IMAGE: ImageLimits = { maxSide: 400, maxBytes: 100 * 1024 };

const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42] as const;
const SHRINK = 0.8;
const MIN_SIDE = 64;

/** أبعاد داخل مربع maxSide مع الحفاظ على النسبة (لا تكبير). */
export function fitWithin(width: number, height: number, maxSide: number) {
  if (width <= 0 || height <= 0) throw new RangeError('image has no size');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type Encoder = (width: number, height: number, quality: number) => Promise<Blob>;

/**
 * يرمّز بجودة تنازلية، ثم يصغّر الأبعاد 20% ويعيد، حتى يصير الحجم ≤ maxBytes.
 * encode حقن (canvas بالمتصفح، ودالة وهمية بالاختبار).
 */
export async function encodeUnderLimit(
  width: number,
  height: number,
  limits: ImageLimits,
  encode: Encoder,
): Promise<{ blob: Blob; width: number; height: number; quality: number }> {
  let { width: w, height: h } = fitWithin(width, height, limits.maxSide);
  for (;;) {
    for (const quality of QUALITIES) {
      const blob = await encode(w, h, quality);
      if (blob.size <= limits.maxBytes) return { blob, width: w, height: h, quality };
    }
    if (Math.max(w, h) * SHRINK < MIN_SIDE) throw new Error('IMAGE_TOO_COMPLEX');
    w = Math.max(1, Math.round(w * SHRINK));
    h = Math.max(1, Math.round(h * SHRINK));
  }
}

/** ملف صورة من الجهاز ← WebP مصغّر. يرفض المتصفح الذي لا يرمّز WebP (Safari القديم). */
export async function resizeImage(file: Blob, limits: ImageLimits): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('NO_CANVAS');
    const encode: Encoder = (w, h, quality) => {
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      return new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => {
            if (!b) reject(new Error('ENCODE_FAILED'));
            else if (b.type !== 'image/webp') reject(new Error('WEBP_UNSUPPORTED'));
            else resolve(b);
          },
          'image/webp',
          quality,
        ),
      );
    };
    const { blob } = await encodeUnderLimit(bitmap.width, bitmap.height, limits, encode);
    return blob;
  } finally {
    bitmap.close();
  }
}

export function imageErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : '';
  if (m === 'WEBP_UNSUPPORTED') return 'المتصفح لا يدعم تحويل الصور، استخدم Chrome أو Edge';
  if (m === 'IMAGE_TOO_COMPLEX') return 'تعذّر تصغير الصورة للحجم المطلوب، جرّب صورة أخرى';
  return 'تعذّر قراءة الصورة، تأكد أنها صورة صالحة';
}

export function productImagePath(productId: string, now = Date.now()): string {
  return `${productId}/${now}.webp`;
}

export function categoryImagePath(categoryId: number, now = Date.now()): string {
  return `categories/${categoryId}/${now}.webp`;
}

export async function uploadImage(
  supabase: MukhdarClient,
  path: string,
  blob: Blob,
): Promise<void> {
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (error) throw error;
}

/** حذف الصورة القديمة بعد نجاح الاستبدال (أفضل جهد: لا يُفشل الحفظ). */
export async function removeImage(supabase: MukhdarClient, path: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage
    .from(IMAGE_BUCKET)
    .remove([path])
    .catch(() => undefined);
}

export function publicImageUrl(supabase: MukhdarClient, path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
