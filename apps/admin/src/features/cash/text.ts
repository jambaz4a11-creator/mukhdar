// نصوص صفحة تسليم الكاش العربية بمكان واحد (SPEC-cash §4)، دوال صرفة تُختبر بوحدة. الأرقام لاتينية، والمبالغ
// بـ formatIQD، والوقت بتوقيت بغداد.
import { formatElapsedAr, formatIQD } from '@mukhdar/shared';
import { formatDateTime } from '@/features/orders/format';
import { diffFromSigned, differenceLabel } from './difference';

export const STAFF_HISTORY_NOTE = 'يظهر لك سجل آخر 7 أيام فقط. الأقدم عند المدير.';

/** "شامل أجرة التوصيل" أو "بدون أجرة التوصيل (تبقى عند السائق)" حسب الإعداد لحظة العرض (K4) أو التسجيل (K1). */
export function basisLabel(includesDeliveryFee: boolean): string {
  return includesDeliveryFee ? 'شامل أجرة التوصيل' : 'بدون أجرة التوصيل (تبقى عند السائق)';
}

export function heldNowLine(totalIqd: number, drivers: number): string {
  return `الكاش عند السواق الآن: ${formatIQD(totalIqd)} (${drivers} سائق)`;
}

/** "أقدم توصيل من 3 ساعات"؛ أقل من دقيقة "هسه"؛ بلا تاريخ ''. */
export function oldestLine(oldestIso: string | null, now: number = Date.now()): string {
  if (!oldestIso) return '';
  const t = Date.parse(oldestIso);
  if (Number.isNaN(t)) return '';
  const elapsed = formatElapsedAr((now - t) / 60_000);
  return elapsed ? `أقدم توصيل من ${elapsed}` : 'أقدم توصيل: هسه';
}

/** آخر تسليم للسائق بصف الأرصدة: الوقت والمبلغ وشارة الفرق إن وُجد. المبلغ null مع وقت = تسليم أقدم من 7 أيام
 *  والقارئ موظف (R4 L5: الدالة تخفي المبلغ)، فيُعرض الوقت وحده. */
export function lastHandoverLine(
  atIso: string | null,
  receivedIqd: number | null,
  differenceIqd: number | null,
): string {
  if (!atIso) return 'ما سلّم كاش بعد';
  if (receivedIqd === null) return `آخر تسليم ${formatDateTime(atIso)}`;
  const parts = [`آخر تسليم ${formatDateTime(atIso)}`, formatIQD(receivedIqd)];
  if (differenceIqd) parts.push(differenceLabel(diffFromSigned(differenceIqd)));
  return parts.join(' · ');
}
