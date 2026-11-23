import { describe, expect, it } from 'vitest';
import {
  emptyProductForm,
  formatAdminPrice,
  marginPercent,
  priceLabel,
  toProductForm,
  validateAdjust,
  validateProductForm,
  validatePurchase,
  validateThreshold,
  wasteLineCost,
  wasteSummary,
  type ProductFormValues,
  type ProductSource,
} from './forms';
import {
  CATEGORY_IMAGE,
  PRODUCT_IMAGE,
  categoryImagePath,
  encodeUnderLimit,
  fitWithin,
  productImagePath,
  type Encoder,
} from './image';
import { parseFormNumber } from './numbers';

const HALF = 'نص كيلو';

describe('image resize (browser canvas → WebP)', () => {
  it('fits within the max side without upscaling', () => {
    expect(fitWithin(4000, 3000, 800)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1200, 4800, 800)).toEqual({ width: 200, height: 800 });
    expect(fitWithin(300, 200, 800)).toEqual({ width: 300, height: 200 });
    expect(() => fitWithin(0, 10, 800)).toThrow();
  });

  // ترميز وهمي: الحجم يتناسب مع المساحة والجودة (صورة "5MB" من الهاتف)
  const fakeEncoder =
    (bytesPerPixel: number): Encoder =>
    async (w, h, q) =>
      new Blob([new Uint8Array(Math.round(w * h * bytesPerPixel * q))], { type: 'image/webp' });

  it('a large phone photo ends under 200KB at ≤ 800px', async () => {
    const calls: [number, number, number][] = [];
    const encode: Encoder = (w, h, q) => {
      calls.push([w, h, q]);
      return fakeEncoder(1)(w, h, q);
    };
    const r = await encodeUnderLimit(4032, 3024, PRODUCT_IMAGE, encode);
    expect(r.blob.size).toBeLessThanOrEqual(200 * 1024);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(800);
    expect(calls[0]).toEqual([800, 600, 0.82]); // يبدأ بأفضل جودة
  });

  it('lowers quality first, then shrinks the size', async () => {
    const r = await encodeUnderLimit(800, 800, CATEGORY_IMAGE, fakeEncoder(3));
    expect(r.blob.size).toBeLessThanOrEqual(100 * 1024);
    expect(r.width).toBeLessThan(400);
  });

  it('keeps a small image as is', async () => {
    const r = await encodeUnderLimit(200, 100, PRODUCT_IMAGE, fakeEncoder(0.5));
    expect(r).toMatchObject({ width: 200, height: 100, quality: 0.82 });
  });

  it('storage paths per product and per category', () => {
    expect(productImagePath('p-1', 1700000000000)).toBe('p-1/1700000000000.webp');
    expect(categoryImagePath(7, 1700000000000)).toBe('categories/7/1700000000000.webp');
  });
});

describe('form numbers', () => {
  it('Latin and Arabic digits, decimal comma, thousands separators', () => {
    expect(parseFormNumber('2.5')).toBe(2.5);
    expect(parseFormNumber('٢٫٥')).toBe(2.5);
    expect(parseFormNumber('3,000')).toBe(3000);
    expect(parseFormNumber('-1')).toBe(-1);
    expect(parseFormNumber('  ')).toBeNull();
    expect(parseFormNumber('abc')).toBeNaN();
  });
});

describe('price validation (per kilo for half-kilo products)', () => {
  const form = (patch: Partial<ProductFormValues>): ProductFormValues => ({
    ...emptyProductForm(3),
    name: 'طماطة',
    ...patch,
  });

  it('"3000 / كيلو" saves price_iqd = 1500', () => {
    const r = validateProductForm(form({ price: '3000', threshold: '2.5' }));
    expect(r.errors).toEqual({});
    expect(r.payload).toMatchObject({
      unit: HALF,
      price_iqd: 1500,
      low_stock_threshold: 5,
      category_id: 3,
    });
  });

  it('per-kilo 1250 and 1100 are rejected with a clear message', () => {
    expect(validateProductForm(form({ price: '1250' })).errors.price).toMatch(/500/);
    expect(validateProductForm(form({ price: '1100' })).errors.price).toMatch(/500/);
  });

  it('bunch keeps its own price, multiple of 250 (1100 rejected)', () => {
    expect(
      validateProductForm(form({ unit: 'باقة', price: '250', threshold: '5' })).payload,
    ).toMatchObject({
      unit: 'باقة',
      price_iqd: 250,
      low_stock_threshold: 5,
    });
    expect(validateProductForm(form({ unit: 'باقة', price: '1100' })).errors.price).toMatch(/250/);
  });

  it('the new units كيس and عبوة are valid, priced per unit in multiples of 250', () => {
    for (const unit of ['كيس', 'عبوة']) {
      expect(
        validateProductForm(form({ unit, price: '2500', threshold: '5' })).payload,
      ).toMatchObject({
        unit,
        price_iqd: 2500,
      });
      expect(validateProductForm(form({ unit, price: '1100' })).errors.price).toMatch(/250/);
    }
  });

  it('a unit outside SALE_UNITS is not possible', () => {
    expect(validateProductForm(form({ unit: 'كيلو', price: '1000' })).errors.unit).toBeDefined();
  });

  it('requires name and category; threshold in 0.5 kg steps', () => {
    const r = validateProductForm(
      form({ name: ' ', categoryId: '', price: '1000', threshold: '2.3' }),
    );
    expect(Object.keys(r.errors).sort()).toEqual(['categoryId', 'name', 'threshold']);
  });

  it('editing: round-trips the stored product and sends the cost only when changed', () => {
    const src: ProductSource = {
      name: 'خيار',
      category_id: 3,
      unit: HALF,
      price_iqd: 750,
      description: null,
      is_active: true,
      cost_iqd: 375, // قديم: 750 للكيلو (ليس مضاعف 500) يبقى مقبولاً ما دام لم يُلمس
      low_stock_threshold: 5,
    };
    const v = toProductForm(src);
    expect(v).toMatchObject({ price: '1500', cost: '750', threshold: '2.5' });
    const r = validateProductForm(v, src);
    expect(r.errors).toEqual({});
    expect(r.payload).not.toHaveProperty('cost_iqd');
    expect(validateProductForm({ ...v, cost: '1000' }, src).payload).toMatchObject({
      cost_iqd: 500,
    });
    expect(validateProductForm({ ...v, cost: '1250' }, src).errors.cost).toMatch(/500/);
  });

  it('labels and display', () => {
    expect(priceLabel(HALF)).toBe('السعر / كيلو');
    expect(priceLabel('باقة')).toBe('السعر / باقة');
    expect(formatAdminPrice(1500, HALF)).toBe('3,000 د.ع / كيلو');
    expect(formatAdminPrice(250, 'باقة')).toBe('250 د.ع / باقة');
    expect(marginPercent(1000, 750)).toBe(25);
    expect(marginPercent(1000, null)).toBeNull();
  });
});

describe('stock forms', () => {
  it('purchase "2.5 كيلو" at 3000 / كيلو → +5 units at 1500', () => {
    expect(validatePurchase(HALF, '2.5', '3000')).toEqual({ errors: {}, units: 5, unitCost: 1500 });
    expect(validatePurchase(HALF, '2.3', '3000').errors.qty).toBeDefined();
    expect(validatePurchase(HALF, '2', '1250').errors.price).toBeDefined();
    expect(validatePurchase('باقة', '4', '250')).toEqual({ errors: {}, units: 4, unitCost: 250 });
  });

  it('adjustment: signed, needs a note, cannot go below zero', () => {
    expect(validateAdjust(HALF, '-1', 'جرد', 10)).toEqual({ errors: {}, units: -2 });
    expect(validateAdjust(HALF, '-6', 'جرد', 10).errors.qty).toBeDefined();
    expect(validateAdjust(HALF, '1', ' ', 10).errors.note).toBeDefined();
  });

  it('threshold', () => {
    expect(validateThreshold(HALF, '2.5')).toEqual({ value: 5 });
    expect(validateThreshold('حبة', '0')).toEqual({ value: 0 });
    expect(validateThreshold(HALF, '6000')).toHaveProperty('error');
  });
});

describe('daily waste cost on the screen', () => {
  const products = [
    { id: 'tomato', unit: HALF, qty: 84, cost: 500 },
    { id: 'banana', unit: HALF, qty: 40, cost: 750 },
    { id: 'celery', unit: 'باقة', qty: 30, cost: 125 },
    { id: 'apple', unit: HALF, qty: 3, cost: 900 },
    { id: 'onion', unit: HALF, qty: 95, cost: null },
  ];

  it('Σ qty × purchase price per sale unit, with negative units for the batch', () => {
    const s = wasteSummary(products, {
      tomato: '3',
      banana: '1.5',
      celery: '4',
      apple: '0.5',
      onion: '',
    });
    // 6×500 + 3×750 + 4×125 + 1×900
    expect(s.cost).toBe(3000 + 2250 + 500 + 900);
    expect(s.count).toBe(4);
    expect(s.items).toEqual([
      { product_id: 'tomato', qty: -6 },
      { product_id: 'banana', qty: -3 },
      { product_id: 'celery', qty: -4 },
      { product_id: 'apple', qty: -1 },
    ]);
    expect(s.errors).toEqual({});
  });

  it('flags bad lines and lines above the stock; zero and blank are skipped', () => {
    const s = wasteSummary(products, { tomato: '2.3', apple: '2', celery: '0', banana: '' });
    expect(Object.keys(s.errors).sort()).toEqual(['apple', 'tomato']);
    expect(s.count).toBe(0);
  });

  it('products without a purchase price count but add no cost', () => {
    const s = wasteSummary(products, { onion: '1' });
    expect(s).toMatchObject({ count: 1, cost: 0, missingCost: 1 });
    expect(wasteLineCost({ id: 't', unit: HALF, qty: 84, cost: 500 }, '3')).toBe(3000);
    expect(wasteLineCost({ id: 'o', unit: HALF, qty: 95, cost: null }, '1')).toBeNull();
  });
});
