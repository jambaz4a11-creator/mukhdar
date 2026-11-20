// قيم البيئة من apps/driver/.env. Expo يضمّن EXPO_PUBLIC_* فقط، وبالوصول المباشر (process.env.X).
// مفاتيح عامة فقط (publishable)؛ createSupabaseClient يرفض مفتاح service_role/secret.
export interface AppConfig {
  supabaseUrl: string;
  supabaseKey: string;
  /** رقم اتصال المحل لـ "نسيت الرمز؟" (SPEC-driver §2.2). فارغ أو غير صالح = الزر مخفي. */
  shopPhone: string;
  /** واتساب المحل (مسار إعادة الضبط المعتمد، ADR 0001). فارغ أو غير صالح = الزر مخفي. */
  shopWhatsapp: string;
}

export const config: AppConfig = {
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim(),
  supabaseKey: (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim(),
  shopPhone: (process.env.EXPO_PUBLIC_SHOP_PHONE ?? '').trim(),
  shopWhatsapp: (process.env.EXPO_PUBLIC_SHOP_WHATSAPP ?? '').trim(),
};

export function isSupabaseConfigured(
  c: Pick<AppConfig, 'supabaseUrl' | 'supabaseKey'> = config,
): boolean {
  return c.supabaseUrl.startsWith('https://') && c.supabaseKey !== '';
}
