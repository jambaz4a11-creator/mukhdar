// مشاريع Supabase للتطوير (T23 L8): بناء "production" للتطبيق لا يُسمح له بالإشارة لمشروع تطوير.
// المصدر الأصلي لقائمة التطوير scripts/lib/projects.mjs (DEV_PROJECT_REFS)؛ هذه نسخة لأن التطبيق لا يقرأ ملفات
// scripts/. اختبار projects.test.ts يفشل إن اختلفت النسختان (وكذلك نسخة apps/customer/app.config.ts).
export const KNOWN_DEV_PROJECT_REFS: readonly string[] = ['ghcohlrzvehtcettaaiu']; // mukhdar-dev

/** ref المشروع من رابط https://<ref>.supabase.co، أو null. */
export function supabaseRefFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const m = /^([a-z0-9]+)\.supabase\.(?:co|in)$/.exec(new URL(url.trim()).hostname);
    return m ? (m[1] as string) : null;
  } catch {
    return null;
  }
}

/** هل الرابط لمشروع تطوير معروف؟ */
export function isDevSupabaseUrl(url: string | null | undefined): boolean {
  const ref = supabaseRefFromUrl(url);
  return ref !== null && KNOWN_DEV_PROJECT_REFS.includes(ref);
}

/** بناء إنتاج يشير لمشروع تطوير = خطأ إعداد (يمنعه app.config.ts وقت البناء، ويوقفه التطبيق وقت التشغيل). */
export function isProductionOnDevBackend(
  appEnv: string | null | undefined,
  supabaseUrl: string | null | undefined,
): boolean {
  return appEnv === 'production' && isDevSupabaseUrl(supabaseUrl);
}
