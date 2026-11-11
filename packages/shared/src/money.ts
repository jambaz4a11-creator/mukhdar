// المبالغ أعداد صحيحة بالدينار العراقي. الحساب الحقيقي داخل قاعدة البيانات؛ هذه للعرض والتحقق المبكر.

export const IQD_STEP = 250;
const CURRENCY = 'د.ع';

/**
 * يعرض المبلغ بأرقام لاتينية وفواصل آلاف: 12500 ← "12,500 د.ع".
 * لا يعتمد على Intl (دعمه يختلف بين محركات الموبايل).
 */
export function formatIQD(amount: number): string {
  if (!Number.isFinite(amount)) throw new RangeError(`formatIQD: not a finite number: ${amount}`);
  const n = Math.round(amount);
  const digits = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${digits} ${CURRENCY}`;
}

/**
 * التقريب لأقرب 250 (النصف للأعلى)، مطابق لـ public.round_iqd: ((n + 125) / 250) * 250
 * بقسمة صحيحة. للمبالغ الصحيحة غير السالبة فقط، مثل الدالة بقاعدة البيانات.
 */
export function roundIQD(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(amount + IQD_STEP / 2)) {
    throw new RangeError(`roundIQD: expected a non-negative safe integer, got ${amount}`);
  }
  return Math.floor((amount + IQD_STEP / 2) / IQD_STEP) * IQD_STEP;
}

/** سعر صالح: عدد صحيح موجب ومن مضاعفات 250 (نفس قيد products.price_iqd). */
export function isValidPrice(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount > 0 && amount % IQD_STEP === 0;
}
