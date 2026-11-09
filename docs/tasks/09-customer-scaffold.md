# 09: هيكل تطبيق الزبون

**الهدف:** تطبيق Expo يفتح بالعربية RTL ويتصل بـ Supabase.

## الخطوات
- `apps/customer` بـ `create-expo-app` (TypeScript، Expo Router). `app.config.ts` يقرأ `.env`.
- RTL: `I18nManager.allowRTL(true)` و`forceRTL(true)` + إعادة تحميل مرة واحدة بأول تشغيل. ملف `src/i18n/ar.ts`.
- خط عربي (مثل IBM Plex Sans Arabic أو Cairo، حسب ملف التصميم) عبر `expo-font`.
- Providers: TanStack Query (+ persist على AsyncStorage)، Supabase client من `packages/shared`.
- التبويبات الأربعة بشاشات فارغة، وثيم الألوان من التصميم.
- Sentry (`@sentry/react-native`).
- `eas.json` بملفات development / preview / production.

## القبول
- يعمل على Expo Go (iOS وAndroid) والاتجاه من اليمين لليسار بكل الشاشات.
- قراءة `app_settings` من Supabase تظهر بالرئيسية (اختبار اتصال).

## الاختبارات
- اختبار RNTL: التبويبات تُعرض بالعربية.
- اختبار: خطأ متعمد يصل لـ Sentry (يدوي، مرة واحدة).
