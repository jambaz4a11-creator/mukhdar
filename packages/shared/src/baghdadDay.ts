// يوم بغداد (UTC+3 ثابت، بلا توقيت صيفي؛ يطابق public.baghdad_today()): [00:00, 24:00) كفاصل نصف مفتوح.
// يُستعمل لسجل اليوم بتطبيق السائق: delivered_at >= from و < to.
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DayRange {
  /** بداية اليوم (شاملة) ISO UTC */
  from: string;
  /** بداية اليوم التالي (غير شاملة) ISO UTC */
  to: string;
}

export function baghdadDayRange(now: number | Date = Date.now()): DayRange {
  const t = typeof now === 'number' ? now : now.getTime();
  const startLocal = Math.floor((t + BAGHDAD_OFFSET_MS) / DAY_MS) * DAY_MS;
  const from = startLocal - BAGHDAD_OFFSET_MS;
  return { from: new Date(from).toISOString(), to: new Date(from + DAY_MS).toISOString() };
}

/** مجموع الكاش بيد السائق: Σ total_iqd (يشمل أجرة التوصيل: يستلم المجموع كاملاً، SPEC-driver §2.9). */
export function sumCash(orders: readonly { total_iqd: number }[]): number {
  return orders.reduce((sum, o) => sum + o.total_iqd, 0);
}
