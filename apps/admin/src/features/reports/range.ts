// مدى التقارير (SPEC-admin §2.5): اليوم، أمس، آخر 7 أيام، هذا الشهر، أو مخصص. الأيام بتوقيت بغداد
// (YYYY-MM-DD)، والحد الأقصى 366 يوماً (نفس قاعدة البيانات، INVALID_DATE_RANGE). دوال صرفة.
import { baghdadToday, isDay } from '@/features/orders/filters';

export type RangePreset = 'today' | 'yesterday' | '7d' | 'month' | 'custom';

export const PRESETS: readonly { id: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { id: 'today', label: 'اليوم' },
  { id: 'yesterday', label: 'أمس' },
  { id: '7d', label: 'آخر 7 أيام' },
  { id: 'month', label: 'هذا الشهر' },
];

export const MAX_RANGE_DAYS = 366;

export interface DayRange {
  from: string;
  to: string;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** عدد الأيام شاملاً الطرفين. */
export function rangeDays(r: DayRange): number {
  return (
    Math.round((Date.parse(`${r.to}T12:00:00Z`) - Date.parse(`${r.from}T12:00:00Z`)) / 86_400_000) +
    1
  );
}

export function presetRange(
  preset: Exclude<RangePreset, 'custom'>,
  today: string = baghdadToday(),
): DayRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case '7d':
      return { from: addDays(today, -6), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

/** تحقق المدى المخصص: رسالة خطأ عربية أو null. */
export function rangeError(r: { from: string; to: string }): string | null {
  if (!isDay(r.from) || !isDay(r.to)) return 'اختر تاريخ البداية والنهاية';
  if (r.from > r.to) return 'تاريخ البداية بعد تاريخ النهاية';
  if (rangeDays(r) > MAX_RANGE_DAYS) return `المدى أطول من ${MAX_RANGE_DAYS} يوماً`;
  return null;
}

/** "2026-11-10 ← 2026-11-16" أو يوم واحد. */
export function rangeLabel(r: DayRange): string {
  return r.from === r.to ? r.from : `${r.from} ← ${r.to}`;
}

/** فرق النسبة (للملغاة من الطلبات) بلا قسمة على صفر: "2.1%" أو null. */
export function percent(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return `${(Math.round((part / whole) * 1000) / 10).toString()}%`;
}
