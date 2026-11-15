// أوقات الطلب بتوقيت بغداد (UTC+3 ثابت، العراق بلا توقيت صيفي). حساب يدوي بدل Intl حتى تكون النتيجة نفسها
// على كل الأجهزة وبالاختبارات. الأرقام لاتينية مثل formatIQD.
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function baghdad(iso: string): Date {
  // تاريخ "مزاح" نقرأ منه بـ getUTC* حتى يطلع وقت بغداد مهما كانت منطقة الجهاز
  return new Date(new Date(iso).getTime() + BAGHDAD_OFFSET_MS);
}

/** "10:24 ص" / "3:05 م" */
export function formatTime(iso: string): string {
  const d = baghdad(iso);
  const h24 = d.getUTCHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m} ${h24 < 12 ? 'ص' : 'م'}`;
}

function dayNumber(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

/** "اليوم، 10:24 ص" / "أمس، 9:00 م" / "12/11/2026، 10:24 ص" */
export function formatOrderDate(iso: string, now: Date = new Date()): string {
  const d = baghdad(iso);
  const diff = dayNumber(baghdad(now.toISOString())) - dayNumber(d);
  const day =
    diff === 0
      ? 'اليوم'
      : diff === 1
        ? 'أمس'
        : `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
  return `${day}، ${formatTime(iso)}`;
}
