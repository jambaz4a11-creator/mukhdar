// الكميات والأسعار بالكيلو داخل لوحة الأدمن (SPEC-admin §2.9، قرار المالك 2026-11-15).
// قاعدة البيانات تخزّن وحدات البيع (أنصاف الكيلو لمنتجات "نص كيلو") والسعر لكل وحدة بيع؛
// اللوحة تعرض وتُدخل بالكيلو (خطوة 0.5) وسعر الكيلو (مضاعف 500). هذا المساعد هو المكان الوحيد
// للتحويل: لا `* 2` ولا `/ 2` داخل الصفحات. الباقة والحبة وباقي الوحدات تمر كما هي.
import { HALF_KILO_UNIT } from './quantity';
import { IQD_STEP } from './money';

/** سعر الكيلو مضاعف 500 حتى يبقى سعر نص الكيلو مضاعف 250. */
export const PER_KG_PRICE_STEP = IQD_STEP * 2;
export const KG_STEP = 0.5;
const KG_LABEL = 'كيلو';

export function isKiloProduct(unit: string): boolean {
  return unit.trim() === HALF_KILO_UNIT;
}

/** كيلو ← وحدات بيع (أنصاف). يقبل السالب (تسويات الجرد) والصفر؛ يرفض غير مضاعفات 0.5. */
export function kgToUnits(kg: number): number {
  const units = kg * 2;
  if (!Number.isFinite(kg) || !Number.isSafeInteger(units)) {
    throw new RangeError(`kgToUnits: expected a multiple of 0.5 kg, got ${kg}`);
  }
  return units === 0 ? 0 : units; // لا -0
}

/** وحدات بيع (أنصاف) ← كيلو. */
export function unitsToKg(units: number): number {
  if (!Number.isSafeInteger(units)) {
    throw new RangeError(`unitsToKg: expected an integer number of units, got ${units}`);
  }
  return units / 2;
}

export function isValidPerKgPrice(perKg: number): boolean {
  return Number.isSafeInteger(perKg) && perKg > 0 && perKg % PER_KG_PRICE_STEP === 0;
}

/** سعر الكيلو ← سعر نص الكيلو. يرفض غير مضاعفات 500 (مثلاً 1250). */
export function perKgToUnitPrice(perKg: number): number {
  if (!isValidPerKgPrice(perKg)) {
    throw new RangeError(
      `perKgToUnitPrice: per-kilo price must be a positive multiple of 500, got ${perKg}`,
    );
  }
  return perKg / 2;
}

/** سعر نص الكيلو ← سعر الكيلو. */
export function unitPriceToPerKg(price: number): number {
  if (!Number.isSafeInteger(price) || price < 0) {
    throw new RangeError(`unitPriceToPerKg: expected a non-negative integer price, got ${price}`);
  }
  return price * 2;
}

/** وحدات البيع ← كمية اللوحة (كيلو لنص الكيلو، كما هي للباقي). */
export function toAdminQty(units: number, unit: string): number {
  if (isKiloProduct(unit)) return unitsToKg(units);
  if (!Number.isSafeInteger(units))
    throw new RangeError(`toAdminQty: expected an integer, got ${units}`);
  return units;
}

/** كمية اللوحة ← وحدات البيع. الباقي عدد صحيح فقط. */
export function fromAdminQty(qty: number, unit: string): number {
  if (isKiloProduct(unit)) return kgToUnits(qty);
  if (!Number.isSafeInteger(qty))
    throw new RangeError(`fromAdminQty: expected an integer, got ${qty}`);
  return qty;
}

/** سعر وحدة البيع ← سعر اللوحة (للكيلو لنص الكيلو، للوحدة للباقي). */
export function toAdminPrice(price: number, unit: string): number {
  if (isKiloProduct(unit)) return unitPriceToPerKg(price);
  if (!Number.isSafeInteger(price) || price < 0) {
    throw new RangeError(`toAdminPrice: expected a non-negative integer, got ${price}`);
  }
  return price;
}

/** سعر اللوحة ← سعر وحدة البيع. نص الكيلو: مضاعف 500؛ الباقي: موجب مضاعف 250. */
export function fromAdminPrice(price: number, unit: string): number {
  if (isKiloProduct(unit)) return perKgToUnitPrice(price);
  if (!Number.isSafeInteger(price) || price <= 0 || price % IQD_STEP !== 0) {
    throw new RangeError(`fromAdminPrice: price must be a positive multiple of 250, got ${price}`);
  }
  return price;
}

/** هل السعر المُدخل باللوحة صالح لهذه الوحدة؟ (للتحقق بالنموذج دون استثناء). */
export function isValidAdminPrice(price: number, unit: string): boolean {
  try {
    fromAdminPrice(price, unit);
    return true;
  } catch {
    return false;
  }
}

/** هل الكمية المُدخلة باللوحة صالحة لهذه الوحدة؟ (0.5 لنص الكيلو، عدد صحيح للباقي). */
export function isValidAdminQty(qty: number, unit: string): boolean {
  try {
    fromAdminQty(qty, unit);
    return true;
  } catch {
    return false;
  }
}

/** خطوة الإدخال لحقل الكمية بهذه الوحدة. */
export function adminQtyStep(unit: string): number {
  return isKiloProduct(unit) ? KG_STEP : 1;
}

/** خطوة سعر اللوحة لهذه الوحدة (500 للكيلو، 250 للباقي). */
export function adminPriceStep(unit: string): number {
  return isKiloProduct(unit) ? PER_KG_PRICE_STEP : IQD_STEP;
}

/** "كيلو" لمنتجات نص الكيلو، أو اسم الوحدة ("باقة"، "حبة"...). */
export function adminUnitLabel(unit: string): string {
  return isKiloProduct(unit) ? KG_LABEL : unit.trim();
}

/** "10.5 كيلو"، "0 كيلو"، "3 باقة". يقبل الصفر والسالب (بخلاف formatQuantity). */
export function formatAdminQuantity(units: number, unit: string): string {
  const q = toAdminQty(units, unit);
  return `${q} ${adminUnitLabel(unit)}`;
}
