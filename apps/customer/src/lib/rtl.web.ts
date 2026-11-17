// الويب: الاتجاه من وسم <html dir="rtl"> (src/app/+html.tsx)؛ لا إعادة تحميل ولا expo-updates.
// نفس أسماء التصدير للنسخة الأصلية (rtl.ts).
export const RTL_RELOAD_KEY = 'mukhdar.rtlReloadAt';

export type RtlResult = 'ok' | 'reloading' | 'gave-up';

export function ensureRTL(): Promise<RtlResult> {
  if (typeof document !== 'undefined') {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  }
  return Promise.resolve('ok');
}
