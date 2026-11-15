// قراءة أرقام النماذج: أرقام لاتينية أو عربية (٠-٩)، فاصلة عشرية "." أو "٫"، وإشارة سالبة.
// فارغ ← null؛ غير صالح ← NaN (التحقق بالمساعد adminUnits حسب الوحدة).

const ARABIC_DIGITS = /[٠-٩]/g;

export function parseFormNumber(input: string): number | null {
  const s = input
    .trim()
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace('٫', '.')
    .replace(/,/g, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}
