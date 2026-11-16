// فلاتر شاشة التقييمات (SPEC-admin §2.8). دوال صرفة؛ الحساب كله بقاعدة البيانات (ratings_summary / ratings_list).
import { isDay } from '@/features/orders/filters';
import { formatTime } from '@/features/orders/format';

export type RatingPreset = 'all' | '5' | '4' | 'low3' | 'low2' | 'comment';

/** أزرار الفلترة بترتيب التصميم المعتمد (+ "نجمة ونجمتان" إضافة مسجّلة بـ docs/design/README.md). */
export const PRESETS: readonly { id: RatingPreset; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: '5', label: '5 نجوم' },
  { id: '4', label: '4' },
  { id: 'low3', label: '3 وأقل' },
  { id: 'low2', label: 'نجمة ونجمتان' },
  { id: 'comment', label: 'بيها تعليق' },
];

export interface RatingFilters {
  preset: RatingPreset;
  /** يوم بغداد YYYY-MM-DD أو null */
  from: string | null;
  to: string | null;
}

export function parsePreset(v: string | null): RatingPreset {
  return PRESETS.some((p) => p.id === v) ? (v as RatingPreset) : 'all';
}

/** معاملات الدالتين من الفلتر. */
export function presetArgs(p: RatingPreset): {
  p_min_stars: number;
  p_max_stars: number;
  p_with_comment: boolean;
} {
  switch (p) {
    case '5':
      return { p_min_stars: 5, p_max_stars: 5, p_with_comment: false };
    case '4':
      return { p_min_stars: 4, p_max_stars: 4, p_with_comment: false };
    case 'low3':
      return { p_min_stars: 1, p_max_stars: 3, p_with_comment: false };
    case 'low2':
      return { p_min_stars: 1, p_max_stars: 2, p_with_comment: false };
    case 'comment':
      return { p_min_stars: 1, p_max_stars: 5, p_with_comment: true };
    default:
      return { p_min_stars: 1, p_max_stars: 5, p_with_comment: false };
  }
}

/** من..إلى صالحان (أو فارغان) و"من" لا يتجاوز "إلى". */
export function validRange(from: string | null, to: string | null): boolean {
  if (from !== null && !isDay(from)) return false;
  if (to !== null && !isDay(to)) return false;
  return !(from && to && from > to);
}

export function dateArgs(f: RatingFilters): { p_from?: string; p_to?: string } {
  return {
    ...(f.from ? { p_from: f.from } : {}),
    ...(f.to ? { p_to: f.to } : {}),
  };
}

const MONTHS = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
] as const;

const BAGHDAD_MS = 3 * 3600_000;

function baghdadParts(iso: string): { y: number; m: number; d: number; day: string } {
  const t = new Date(new Date(iso).getTime() + BAGHDAD_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    d: t.getUTCDate(),
    day: t.toISOString().slice(0, 10),
  };
}

/** "اليوم 10:20 ص"، "أمس"، "13 تشرين الثاني"، أو مع السنة إن اختلفت. أرقام لاتينية، يوم بغداد. */
export function formatRatingDate(iso: string, nowIso: string): string {
  const a = baghdadParts(iso);
  const n = baghdadParts(nowIso);
  if (a.day === n.day) return `اليوم ${formatTime(iso)}`;
  const diff = Math.round(
    (Date.parse(`${n.day}T00:00:00Z`) - Date.parse(`${a.day}T00:00:00Z`)) / 86_400_000,
  );
  if (diff === 1) return 'أمس';
  const base = `${a.d} ${MONTHS[a.m]}`;
  return a.y === n.y ? base : `${base} ${a.y}`;
}

/** عدد النجوم الممتلئة بالرأس: الجزء الصحيح من المتوسط (4.6 ← 4 كاملة + 1 باهتة، كالتصميم). */
export function filledStars(avg: number | null): number {
  return avg === null ? 0 : Math.max(0, Math.min(5, Math.floor(avg)));
}

/** لون شريط التوزيع حسب النجوم (التصميم): 4–5 أخضر، 3 كهرماني، 1–2 أحمر. */
export function barColor(stars: number): 'primary' | 'star' | 'danger' {
  return stars >= 4 ? 'primary' : stars === 3 ? 'star' : 'danger';
}

/** عرض الشريط كنسبة من أكبر عدد (0..100). */
export function barPercent(count: number, max: number): number {
  return max <= 0 ? 0 : Math.round((count / max) * 100);
}
