// تسليم الكاش (SPEC-cash §8): الفرق الحي بالنافذة للعرض فقط؛ قاعدة البيانات تعيد حسابه
// (`difference_iqd` عمود مولَّد) ولا يُوثق بقيمة المتصفح.
import { formatIQD } from '@mukhdar/shared';

export type CashDiff = { kind: 'match' | 'shortage' | 'overage'; amount: number };

export function cashDifference(expected: number, received: number): CashDiff {
  const d = received - expected;
  if (d === 0) return { kind: 'match', amount: 0 };
  return d < 0 ? { kind: 'shortage', amount: -d } : { kind: 'overage', amount: d };
}

/** الفرق المخزَّن (موجب = زيادة، سالب = نقص) كـ CashDiff للعرض بالسجل والأرصدة. */
export function diffFromSigned(difference: number): CashDiff {
  return cashDifference(0, difference);
}

export function differenceLabel(diff: CashDiff): string {
  if (diff.kind === 'match') return 'مطابق';
  return `${diff.kind === 'shortage' ? 'نقص' : 'زيادة'} ${formatIQD(diff.amount)}`;
}
