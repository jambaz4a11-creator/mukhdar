// إعداد Expo لتطبيق السائق (T30، SPEC-driver §6). القيم السرية لا توضع هنا: التطبيق يقرأ EXPO_PUBLIC_* من .env.
import type { ConfigContext, ExpoConfig } from 'expo/config';

// T23 L8: بناء production (EAS) لا يُسمح له بالإشارة لمشروع تطوير. القائمة نسخة من scripts/lib/projects.mjs
// (DEV_PROJECT_REFS)؛ اختبار packages/shared/src/__tests__/projects.test.ts يفشل إن اختلفتا.
const DEV_PROJECT_REFS = ['ghcohlrzvehtcettaaiu']; // mukhdar-dev
const supabaseHost = (() => {
  try {
    return new URL((process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim()).hostname;
  } catch {
    return '';
  }
})();
if (
  process.env.APP_ENV === 'production' &&
  DEV_PROJECT_REFS.some((ref) => supabaseHost === `${ref}.supabase.co`)
) {
  throw new Error(
    'APP_ENV=production but EXPO_PUBLIC_SUPABASE_URL points at the mukhdar-dev project. ' +
      'Set the production project URL and publishable key in the EAS production environment.',
  );
}

// R2 M1: معرّف مشروع EAS لتطبيق السائق عام (ليس سراً)، فنثبّته هنا بدل متغير بيئة لا يصل لعامل البناء السحابي.
// EAS_PROJECT_ID يتجاوزه إن وُجد (مثلاً لمشروع آخر).
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID ?? '45b317c2-1949-4ebb-b3eb-4b4d3d797ee6';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'سائق المخضر',
  slug: 'mukhdar-driver',
  scheme: 'mukhdar-driver',
  version: '1.0.0',
  orientation: 'portrait',
  // افتراض T30: نفس أيقونات تطبيق الزبون حتى تصل أيقونة خاصة بالسائق
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.mukhdar.driver',
    supportsTablet: false,
  },
  android: {
    package: 'com.mukhdar.driver',
    // T23 L8: لا نسخ احتياطي تلقائي لبيانات التطبيق (الجلسة وسر الجهاز بـ Keystore ولا يُنسخان)
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: '#F7F8F3',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // T32: FCM بتطبيق Firebase ثانٍ؛ الملف كمتغير ملف بـ EAS (لا يُرفع لـ git)
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
  },
  plugins: [
    'expo-router',
    'expo-font',
    // الجلسة وسر الجهاز بـ Keychain / Keystore
    'expo-secure-store',
    // بالبناء: RTL مفروض أصلياً. في Expo Go يفرضه src/lib/rtl.ts عند التشغيل.
    ['expo-localization', { supportsRTL: true, forcesRTL: true }],
    [
      'expo-splash-screen',
      { backgroundColor: '#F7F8F3', image: './assets/images/splash-icon.png', imageWidth: 76 },
    ],
    ['expo-notifications', { color: '#1F6B3A' }],
  ],
  extra: {
    appEnv: process.env.APP_ENV ?? 'development',
    eas: { projectId: EAS_PROJECT_ID },
  },
});
