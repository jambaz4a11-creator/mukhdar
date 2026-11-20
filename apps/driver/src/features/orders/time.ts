// الزمن بتوقيت بغداد (UTC+3 ثابت، بلا توقيت صيفي)، أرقام لاتينية (design README).
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

/** دقائق مضت منذ `iso` (صحيحة، لا تقل عن 0). */
export function minutesSince(iso: string, nowMs: number = Date.now()): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 60_000));
}

/** "10:48 ص" / "3:05 م" بتوقيت بغداد. */
export function formatBaghdadClock(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + BAGHDAD_OFFSET_MS);
  const h24 = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${minutes} ${h24 < 12 ? 'ص' : 'م'}`;
}
