// الويب (T37): الاتجاه من <html dir="rtl"> (scripts/web-postexport.mjs يضعه أيضاً)؛ لا إعادة تحميل ولا expo-updates.
// نفس أسماء التصدير للنسخة الأصلية (rtl.ts).
export const RTL_RELOAD_KEY = 'mukhdar.driver.rtlReloadAt';

export type RtlResult = 'ok' | 'reloading' | 'gave-up';

/** للتوافق مع توقيع rtl.ts (لا يُستعمل على الويب). */
export interface RtlDeps {
  now: () => number;
}

export const ensureRTL: (deps?: RtlDeps) => Promise<RtlResult> = () => {
  if (typeof document !== 'undefined') {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  }
  return Promise.resolve('ok');
};
