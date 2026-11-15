// إعداد Expo (T09). القيم السرية لا توضع هنا: التطبيق يقرأ EXPO_PUBLIC_* من .env (انظر .env.example).
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'المخضر',
  slug: 'mukhdar',
  scheme: 'mukhdar',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    // افتراض: معرّف مؤقت، يُثبَّت مع حساب Apple بمهمة الإطلاق (T24)
    bundleIdentifier: 'com.mukhdar.customer',
    supportsTablet: false,
  },
  android: {
    package: 'com.mukhdar.customer',
    adaptiveIcon: {
      backgroundColor: '#F7F8F3',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // T14: إشعارات Android عبر FCM. الملف من Firebase، يُمرَّر كمتغير ملف بـ EAS (لا يُرفع لـ git).
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
  },
  web: { favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    'expo-font',
    // T10: الجلسة بـ Keychain / Keystore
    'expo-secure-store',
    // بالبناء (dev/preview/production): RTL مفروض أصلياً. في Expo Go يفرضه src/lib/rtl.ts عند التشغيل.
    ['expo-localization', { supportsRTL: true, forcesRTL: true }],
    [
      'expo-splash-screen',
      { backgroundColor: '#F7F8F3', image: './assets/images/splash-icon.png', imageWidth: 76 },
    ],
    // T14: الإشعارات البعيدة تحتاج development build (لا تعمل في Expo Go منذ SDK 53)
    ['expo-notifications', { color: '#1F6B3A' }],
  ],
  extra: {
    appEnv: process.env.APP_ENV ?? 'development',
    // T14: معرّف مشروع EAS (ليس سراً). بدونه لا يُطلب رمز Expo Push والتطبيق يتخطى التسجيل.
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
});
