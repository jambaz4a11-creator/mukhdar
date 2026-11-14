// عرض الكمية حسب وحدة البيع (products.unit / order_items.unit_snapshot).
// الكمية دائماً عدد صحيح من وحدات البيع: للخضار والفواكه كل وحدة = نص كيلو (السعر لكل نص كيلو).
// هذا سعر ثابت لكل نص كيلو، لا تسعير بالوزن: لا كسور ولا وزن فعلي.

/** وحدة البيع للخضار والفواكه. */
export const HALF_KILO_UNIT = 'نص كيلو';
/** وحدة الأعشاب والورقيات. */
export const BUNCH_UNIT = 'باقة';

/**
 * وحدات البيع المسموحة (قائمة ثابتة لحقل الوحدة بلوحة الأدمن). مطابقة لقيد قاعدة البيانات
 * products_unit_allowed؛ إضافة وحدة = migration جديد يعدّل القيد + تحديث هذه القائمة
 * (اختبار quantity.test.ts يفشل إن اختلفتا).
 */
export const SALE_UNITS = [HALF_KILO_UNIT, BUNCH_UNIT, 'حبة', 'علبة', 'قنينة', 'سلة'] as const;
export type SaleUnit = (typeof SALE_UNITS)[number];

export function isSaleUnit(value: unknown): value is SaleUnit {
  return typeof value === 'string' && (SALE_UNITS as readonly string[]).includes(value);
}

/**
 * "نص كيلو"، "1 كيلو"، "1.5 كيلو"، "2 كيلو"... لوحدة نص الكيلو؛
 * "N باقة" (وأي وحدة أخرى: "N حبة"، "N سلة"...).
 * qty عدد صحيح موجب (كما تفرضه قاعدة البيانات 1..99)، وإلا RangeError.
 */
export function formatQuantity(qty: number, unit: string): string {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new RangeError(`quantity must be a positive integer, got ${qty}`);
  }
  const u = unit.trim();
  if (u === HALF_KILO_UNIT) {
    if (qty === 1) return HALF_KILO_UNIT;
    const kilos = qty / 2; // 1، 1.5، 2، ...
    return `${Number.isInteger(kilos) ? kilos : kilos.toFixed(1)} كيلو`;
  }
  return `${qty} ${u}`;
}
