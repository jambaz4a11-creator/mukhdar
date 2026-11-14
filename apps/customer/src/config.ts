// قيم البيئة من apps/customer/.env. Expo يضمّن EXPO_PUBLIC_* فقط، وبالوصول المباشر (process.env.X).
// مفاتيح عامة فقط (publishable)؛ createSupabaseClient يرفض مفتاح service_role/secret.
export interface AppConfig {
  supabaseUrl: string;
  supabaseKey: string;
  sentryDsn: string;
}

export const config: AppConfig = {
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim(),
  supabaseKey: (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim(),
  sentryDsn: (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim(),
};

export function isSupabaseConfigured(c: AppConfig = config): boolean {
  return c.supabaseUrl.startsWith('https://') && c.supabaseKey !== '';
}
