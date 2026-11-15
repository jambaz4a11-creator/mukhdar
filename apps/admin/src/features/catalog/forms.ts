// تحقق نماذج المنتجات والمخزون والهدر، والعرض بالكيلو. كل تحويل كيلو ↔ وحدات عبر adminUnits
// (packages/shared، SPEC-admin §2.9)؛ لا `* 2` ولا `/ 2` هنا. قاعدة البيانات تتحقق مرة أخرى.
import {
  SALE_UNITS,
  adminUnitLabel,
  formatAdminQuantity,
  formatIQD,
  fromAdminPrice,
  fromAdminQty,
  isKiloProduct,
  isSaleUnit,
  toAdminPrice,
  toAdminQty,
} from '@mukhdar/shared';
import { parseFormNumber } from './numbers';

export { SALE_UNITS };

export const NAME_MAX = 80;
export const THRESHOLD_MAX_UNITS = 10_000;

/** "السعر / كيلو" لنص الكيلو، و"السعر / باقة" للباقي. */
export function priceLabel(unit: string, prefix = 'السعر'): string {
  return `${prefix} / ${adminUnitLabel(unit)}`;
}

/** "3,000 د.ع / كيلو" من سعر وحدة البيع. */
export function formatAdminPrice(price: number, unit: string): string {
  return `${formatIQD(toAdminPrice(price, unit))} / ${adminUnitLabel(unit)}`;
}

export function priceRuleMessage(unit: string): string {
  return isKiloProduct(unit)
    ? 'سعر الكيلو لازم يكون من مضاعفات 500 (مثل 1000، 1500، 3000)'
    : 'السعر لازم يكون من مضاعفات 250';
}

export function qtyRuleMessage(unit: string): string {
  return isKiloProduct(unit) ? 'الكمية بالكيلو بخطوة 0.5 (مثل 2 أو 2.5)' : 'الكمية عدد صحيح';
}

/** هامش الربح % من سعر البيع (لكل وحدة بيع؛ النسبة لا تتغير بالكيلو). */
export function marginPercent(price: number, cost: number | null): number | null {
  if (cost === null || price <= 0) return null;
  return Math.round(((price - cost) / price) * 100);
}

/** سعر لوحة (للكيلو أو للوحدة) ← سعر وحدة البيع، أو رسالة خطأ. */
export function parseAdminPrice(
  input: string,
  unit: string,
  { allowZero = false } = {},
): { value: number } | { error: string } {
  const n = parseFormNumber(input);
  if (n === null) return { error: 'اكتب السعر' };
  if (allowZero && n === 0) return { value: 0 };
  try {
    return { value: fromAdminPrice(n, unit) };
  } catch {
    return { error: priceRuleMessage(unit) };
  }
}

/** كمية لوحة (كيلو أو وحدة) ← وحدات بيع، أو رسالة خطأ. */
export function parseAdminQty(
  input: string,
  unit: string,
  { allowNegative = false, allowZero = false } = {},
): { value: number } | { error: string } {
  const n = parseFormNumber(input);
  if (n === null) return { error: 'اكتب الكمية' };
  let units: number;
  try {
    units = fromAdminQty(n, unit);
  } catch {
    return { error: qtyRuleMessage(unit) };
  }
  if (units === 0 && !allowZero) return { error: 'الكمية لا تكون صفراً' };
  if (units < 0 && !allowNegative) return { error: 'الكمية لا تكون سالبة' };
  if (Math.abs(units) > 100_000) return { error: 'الكمية كبيرة جداً' };
  return { value: units };
}

// ---------------------------------------------------------------- نموذج المنتج
export interface ProductFormValues {
  name: string;
  categoryId: string;
  unit: string;
  price: string;
  cost: string;
  threshold: string;
  description: string;
  isActive: boolean;
}

export type ProductField = 'name' | 'categoryId' | 'unit' | 'price' | 'cost' | 'threshold';

/** جسم admin_save_product (بوحدات البيع). cost_iqd يُرسل فقط إن تغيّر. */
export interface ProductPayload {
  name: string;
  category_id: number;
  unit: string;
  price_iqd: number;
  description: string | null;
  is_active: boolean;
  low_stock_threshold: number;
  cost_iqd?: number;
}

export interface ProductSource {
  name: string;
  category_id: number;
  unit: string;
  price_iqd: number;
  description: string | null;
  is_active: boolean;
  cost_iqd: number | null;
  low_stock_threshold: number;
}

export function emptyProductForm(categoryId?: number): ProductFormValues {
  return {
    name: '',
    categoryId: categoryId ? String(categoryId) : '',
    unit: SALE_UNITS[0],
    price: '',
    cost: '',
    threshold: String(toAdminQty(5, SALE_UNITS[0])),
    description: '',
    isActive: true,
  };
}

export function toProductForm(p: ProductSource): ProductFormValues {
  return {
    name: p.name,
    categoryId: String(p.category_id),
    unit: p.unit,
    price: String(toAdminPrice(p.price_iqd, p.unit)),
    cost: p.cost_iqd === null ? '' : String(toAdminPrice(p.cost_iqd, p.unit)),
    threshold: String(toAdminQty(p.low_stock_threshold, p.unit)),
    description: p.description ?? '',
    isActive: p.is_active,
  };
}

export function validateProductForm(
  v: ProductFormValues,
  original?: ProductSource,
): { errors: Partial<Record<ProductField, string>>; payload: ProductPayload | null } {
  const errors: Partial<Record<ProductField, string>> = {};
  const name = v.name.trim();
  if (!name) errors.name = 'اكتب اسم المنتج';
  else if (name.length > NAME_MAX) errors.name = `الاسم أطول من ${NAME_MAX} حرف`;

  const categoryId = Number(v.categoryId);
  if (!v.categoryId || !Number.isSafeInteger(categoryId)) errors.categoryId = 'اختر القسم';

  if (!isSaleUnit(v.unit)) errors.unit = 'اختر وحدة البيع من القائمة';
  const unit = v.unit;

  let price = 0;
  if (!errors.unit) {
    const p = parseAdminPrice(v.price, unit);
    if ('error' in p) errors.price = p.error;
    else price = p.value;
  }

  // سعر الشراء: اختياري (الطبيعي من المشتريات)؛ يُرسل فقط إن تغيّر عن المحفوظ
  // (سعر قديم محفوظ لم يُلمس لا يُعاد تحققه: بعض أسعار الشراء القديمة ليست مضاعف 500 للكيلو)
  let cost: number | undefined;
  const untouchedCost =
    original !== undefined &&
    original.cost_iqd !== null &&
    original.unit === unit &&
    v.cost.trim() === String(toAdminPrice(original.cost_iqd, original.unit));
  if (!errors.unit && v.cost.trim() !== '' && !untouchedCost) {
    const c = parseAdminPrice(v.cost, unit, { allowZero: true });
    if ('error' in c) errors.cost = c.error;
    else if (!original || original.cost_iqd !== c.value || original.unit !== unit) cost = c.value;
  }

  let threshold = 0;
  if (!errors.unit) {
    const t = parseAdminQty(v.threshold, unit, { allowZero: true });
    if ('error' in t) errors.threshold = t.error;
    else if (t.value > THRESHOLD_MAX_UNITS) errors.threshold = 'حد النقص كبير جداً';
    else threshold = t.value;
  }

  if (Object.keys(errors).length > 0) return { errors, payload: null };
  const payload: ProductPayload = {
    name,
    category_id: categoryId,
    unit,
    price_iqd: price,
    description: v.description.trim() || null,
    is_active: v.isActive,
    low_stock_threshold: threshold,
  };
  if (cost !== undefined) payload.cost_iqd = cost;
  return { errors, payload };
}

// ---------------------------------------------------------------- المشتريات والتسوية والحد
export function validatePurchase(
  unit: string,
  qtyInput: string,
  priceInput: string,
): { errors: { qty?: string; price?: string }; units: number; unitCost: number } {
  const errors: { qty?: string; price?: string } = {};
  const q = parseAdminQty(qtyInput, unit);
  const p = parseAdminPrice(priceInput, unit);
  if ('error' in q) errors.qty = q.error;
  if ('error' in p) errors.price = p.error;
  return {
    errors,
    units: 'value' in q ? q.value : 0,
    unitCost: 'value' in p ? p.value : 0,
  };
}

export function validateAdjust(
  unit: string,
  qtyInput: string,
  note: string,
  currentUnits: number,
): { errors: { qty?: string; note?: string }; units: number } {
  const errors: { qty?: string; note?: string } = {};
  const q = parseAdminQty(qtyInput, unit, { allowNegative: true });
  if ('error' in q) errors.qty = q.error;
  else if (currentUnits + q.value < 0) errors.qty = 'الرصيد لا يصير سالباً';
  if (!note.trim()) errors.note = 'اكتب سبب التسوية';
  return { errors, units: 'value' in q ? q.value : 0 };
}

export function validateThreshold(
  unit: string,
  input: string,
): { value: number } | { error: string } {
  const t = parseAdminQty(input, unit, { allowZero: true });
  if ('error' in t) return t;
  if (t.value > THRESHOLD_MAX_UNITS) return { error: 'حد النقص كبير جداً' };
  return t;
}

// ---------------------------------------------------------------- هدر اليوم
export interface WasteProduct {
  id: string;
  unit: string;
  qty: number; // الرصيد بوحدات البيع
  cost: number | null; // سعر الشراء لكل وحدة بيع (null = غير محدد)
}

export interface WasteSummary {
  items: { product_id: string; qty: number }[]; // qty سالبة (وحدات بيع)
  count: number;
  cost: number;
  missingCost: number;
  errors: Record<string, string>;
}

/** كلفة الهدر قبل الحفظ: Σ الكمية × سعر الشراء، وبنود adjust_stock_bulk ('waste'، كميات سالبة). */
export function wasteSummary(
  products: WasteProduct[],
  entries: Record<string, string>,
): WasteSummary {
  const out: WasteSummary = { items: [], count: 0, cost: 0, missingCost: 0, errors: {} };
  for (const p of products) {
    const raw = entries[p.id] ?? '';
    if (raw.trim() === '') continue;
    const q = parseAdminQty(raw, p.unit, { allowZero: true });
    if ('error' in q) {
      out.errors[p.id] = q.error;
      continue;
    }
    if (q.value === 0) continue;
    if (q.value > p.qty) {
      out.errors[p.id] = `أكثر من الرصيد (${formatAdminQuantity(p.qty, p.unit)})`;
      continue;
    }
    out.items.push({ product_id: p.id, qty: -q.value });
    out.count += 1;
    if (p.cost === null) out.missingCost += 1;
    else out.cost += q.value * p.cost;
  }
  return out;
}

/** كلفة سطر واحد بالشاشة (null إن لم تُكتب كمية صالحة). */
export function wasteLineCost(p: WasteProduct, raw: string): number | null {
  if (raw.trim() === '') return null;
  const q = parseAdminQty(raw, p.unit, { allowZero: true });
  if ('error' in q || q.value === 0) return null;
  return p.cost === null ? null : q.value * p.cost;
}
