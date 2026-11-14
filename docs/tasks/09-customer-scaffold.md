# 09: هيكل تطبيق الزبون ✅

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

## الحالة (2026-11-14)
- ✅ Expo SDK 58 + Expo Router (`apps/customer`)، RTL، IBM Plex Sans Arabic، TanStack Query (+ persist)، Supabase من `packages/shared`، التبويبات الأربعة، الثيم من `docs/design/README.md`، Sentry (معطّل بلا DSN)، `eas.json`.
- ✅ اختبارات: RNTL للتبويبات بالعربية، الرئيسية تقرأ `app_settings`، Sentry no-op، حماية RTL، تطابق الثيم مع README. `expo export` (Android وiOS) و`expo-doctor` 20/20. قراءة `app_settings` من `mukhdar-dev` بالمفتاح العام تحققت عبر REST.
- ⏳ يدوي لدى صاحب المشروع: فتح التطبيق على Expo Go (iOS وAndroid) والتأكد من RTL بكل الشاشات، و"خطأ متعمد يصل لـ Sentry" (يحتاج DSN).
