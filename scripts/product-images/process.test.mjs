import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { MAX_BYTES, processProductImage, whiteBorderRatio } from './process.mjs';

const solid = (w, h, bg) => sharp({ create: { width: w, height: h, channels: 3, background: bg } });

test('wide image on white → 800x800 WebP, subject kept whole, small file', async () => {
  const subject = await solid(300, 200, '#cc2222').png().toBuffer();
  const src = await solid(1600, 900, '#ffffff')
    .composite([{ input: subject, gravity: 'centre' }])
    .jpeg()
    .toBuffer();
  assert.ok((await whiteBorderRatio(src)) > 0.9);
  const out = await processProductImage(src);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.format, 'webp');
  assert.deepEqual([meta.width, meta.height], [800, 800]);
  assert.ok(out.buffer.length <= MAX_BYTES);
  const px = await sharp(out.buffer)
    .extract({ left: 0, top: 0, width: 4, height: 4 })
    .raw()
    .toBuffer();
  assert.ok(px[0] > 240); // الزاوية بيضاء: لا قص ولا حواف سوداء
});

test('large noisy near-square photo is cropped to a square WebP under 200KB', async () => {
  const noise = Buffer.alloc(2000 * 1800 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + (i >> 3) * 31) & 255;
  const src = await sharp(noise, { raw: { width: 2000, height: 1800, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
  const out = await processProductImage(src);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, meta.height);
  assert.ok(out.buffer.length <= MAX_BYTES);
});
