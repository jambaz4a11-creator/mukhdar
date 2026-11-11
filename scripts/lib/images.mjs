// صور منتجات تجريبية خفيفة (T05): PNG بسيط 240×240 لكل منتج (لون حسب القسم)، أقل من 5KB.
// تُرفع لـ bucket product-images عبر Storage API بمفتاح service_role (للتطوير فقط، من .env.local).
// بدون المفتاح: تُتخطى الصور برسالة، وباقي البيانات تُنشأ عادي.
import zlib from 'node:zlib';
import { readEnvLocal } from './db.mjs';

const SIZE = 240;
const BUCKET = 'product-images';

// لون لكل قسم (بالترتيب sort_order)
const PALETTE = [
  [
    [226, 244, 222],
    [76, 153, 72],
  ], // خضروات
  [
    [255, 236, 214],
    [232, 120, 40],
  ], // فواكه
  [
    [220, 242, 230],
    [40, 140, 90],
  ], // ورقيات
  [
    [255, 228, 236],
    [210, 60, 110],
  ], // مستوردة
  [
    [242, 230, 214],
    [140, 90, 50],
  ], // تمور
  [
    [232, 230, 250],
    [100, 90, 190],
  ], // سلال
];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** PNG بخلفية فاتحة ودائرة بلون القسم؛ حجم الدائرة يختلف قليلاً حسب variant. */
export function productPng(categoryIndex, variant = 0) {
  const [bg, fg] = PALETTE[categoryIndex % PALETTE.length];
  const r = 70 + (variant % 5) * 8;
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 6;
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const leaf = Math.hypot(x - cx - 18, y - (cy - r - 4)) < 14;
      const color = d < r ? fg : leaf ? [60, 150, 60] : bg;
      raw.set(color, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function apiUrl(target) {
  if (target.kind === 'remote') return `https://${target.projectRef}.supabase.co`;
  return process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
}

/** يرفع صورة لكل منتج بلا صورة ويضبط image_path. يتخطى إذا لم يوجد مفتاح service_role. */
export async function uploadProductImages(client, target) {
  const key = readEnvLocal('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    console.log('images: skipped (SUPABASE_SERVICE_ROLE_KEY not set; see RUNBOOK §10)');
    return;
  }
  const { rows } = await client.query(
    `select p.id, c.sort_order as cat, p.sort_order as n
       from public.products p join public.categories c on c.id = p.category_id
      where p.image_path is null order by c.sort_order, p.sort_order`,
  );
  let uploaded = 0;
  for (const p of rows) {
    const objectPath = `demo/${p.id}.png`;
    const res = await fetch(`${apiUrl(target)}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: productPng(Math.max(0, p.cat - 1), p.n),
    });
    if (!res.ok) throw new Error(`image upload failed (${res.status}): ${await res.text()}`);
    await client.query('update public.products set image_path = $1 where id = $2', [
      objectPath,
      p.id,
    ]);
    uploaded++;
  }
  console.log(`images: ${uploaded} uploaded to ${BUCKET}/demo/`);
}
