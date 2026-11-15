// قيم البيئة من apps/customer/.env. Expo يضمّن EXPO_PUBLIC_* فقط، وبالوصول المباشر (process.env.X).
// مفاتيح عامة فقط (publishable)؛ createSupabaseClient يرفض مفتاح service_role/secret.
export interface AppConfig {
  supabaseUrl: string;
  supabaseKey: string;
  sentryDsn: string;
  /** رقم واتساب المتجر لـ "نسيت الرمز؟" (افتراض SPEC-customer §2.1، حتى يُضاف لـ app_settings). */
  shopWhatsapp: string;
  /** رقم اتصال المتجر لـ "اتصل بالمحل" (T15). فارغ = الزر مخفي. */
  shopPhone: string;
  /** روابط سياسة الخصوصية والشروط (T15؛ الصفحات بلوحة الأدمن، T16). فارغ أو غير https = مخفي. */
  privacyUrl: string;
  termsUrl: string;
}

export const config: AppConfig = {
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim(),
  supabaseKey: (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim(),
  sentryDsn: (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim(),
  shopWhatsapp: (process.env.EXPO_PUBLIC_SHOP_WHATSAPP ?? '').trim(),
  shopPhone: (process.env.EXPO_PUBLIC_SHOP_PHONE ?? '').trim(),
  privacyUrl: (process.env.EXPO_PUBLIC_PRIVACY_URL ?? '').trim(),
  termsUrl: (process.env.EXPO_PUBLIC_TERMS_URL ?? '').trim(),
};

export function isSupabaseConfigured(
  c: Pick<AppConfig, 'supabaseUrl' | 'supabaseKey'> = config,
): boolean {
  return c.supabaseUrl.startsWith('https://') && c.supabaseKey !== '';
}
