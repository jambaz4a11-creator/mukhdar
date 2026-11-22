import { differenceLabel, type CashDiff } from './difference';

const TONE: Record<CashDiff['kind'], string> = {
  match: 'bg-primary-soft text-primary',
  shortage: 'bg-danger-soft text-danger',
  overage: 'bg-warning-soft text-warning-text',
};

/** شارة الفرق: أخضر "مطابق"، أحمر "نقص Y د.ع"، برتقالي "زيادة Y د.ع". */
export function DiffBadge({ diff, testId }: { diff: CashDiff; testId?: string }) {
  return (
    <span
      data-testid={testId}
      data-diff={diff.kind}
      className={`num inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${TONE[diff.kind]}`}
    >
      {differenceLabel(diff)}
    </span>
  );
}
