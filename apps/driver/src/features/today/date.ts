// تسمية تاريخ اليوم بتوقيت بغداد (UTC+3): "الخميس 19 تشرين الثاني"، وأرقام بفواصل آلاف (أرقام لاتينية).
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const;
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

export function formatBaghdadDateLabel(now: number = Date.now()): string {
  const d = new Date(now + BAGHDAD_OFFSET_MS);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "18 تشرين الثاني" لتوقيت بغداد من ISO (سجل التسليمات وبطاقة الكاش). */
export function formatBaghdadDayMonth(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + BAGHDAD_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** 74750 ← "74,750" */
export function groupDigits(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
