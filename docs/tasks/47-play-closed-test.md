# 47: تجهيز تطبيق الزبون (أندرويد) لاختبار مغلق على Google Play ✅

> قرار المالك 2026-11-24. **النموذج:** Sonnet. **على dev:** موافقة المالك على بناء EAS سحابي (أُعطيت)؛ لا migration ولا نشر دوال ولا شيء على الإنتاج.

## ما تغيّر
- **مشروع EAS** للزبون تحت حساب المالك `jafar_sadiq20`: `@jafar_sadiq20/mukhdar`، المعرّف `9774f741-7bab-47f9-a1a8-6d7cf4a31042` (عام) صار الافتراضي بـ `app.config.ts` مع `owner` (مثل تطبيق السائق؛ `EAS_PROJECT_ID` ما زال يتجاوزه). مشروع واحد لـ iOS وAndroid.
- **`apps/customer/eas.json`:** كل profile يسمّي بيئته (`environment`)، وprofile جديد `closedtest` (`.aab`، `store`، `autoIncrement`، بيئة `preview`، `APP_ENV=preview` ← mukhdar-dev). `production` يرفض dev كما كان.
- **متغيرات EAS `preview`** (عامة، plaintext): `EXPO_PUBLIC_SUPABASE_URL`، `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`، `EXPO_PUBLIC_PRIVACY_URL`، `EXPO_PUBLIC_TERMS_URL`.
- **`docs/PLAY-STORE.md`** (عربي/إنجليزي): البناء والرفع، صفحة المتجر، اللقطات (8 لقطات 1080×1920 بـ `docs/play-store/screenshots/` من نسخة الويب الحية)، أمان البيانات، تصنيف المحتوى، تعليمات المراجعين.
- **`docs/HANDOFF-IOS.md`:** مشروع EAS المشترك وكيف يُشارَك مع مطوّر iOS، وإزالة بند "eas.json ناقص".

## افتراضات
- **الحزمة `com.mukhdar.customer`** كما هي بالإعداد (تتطابق مع iOS)؛ تثبت نهائياً عند أول رفع على Play.
- **مفتاح التوقيع** أنشأه EAS (بعيد). على المالك تنزيل نسخة احتياطية.
- **المشروع تحت الحساب الشخصي** كما طُلب. الحسابات الشخصية لا تدعم متعاونين، فمشاركته مع مطوّر iOS تتطلب نقله لمنظمة Expo (النقل يحفظ المعرّف، لا يتغيّر شيء بالكود). الخطوات بـ HANDOFF-IOS §5.
- **FCM غير مضبوط** (لا `google-services.json`): البناء يعمل والإشعارات لا تصل لأندرويد؛ الخطوات الدقيقة بـ PLAY-STORE.md. لم يُلمس Firebase ولا الأسرار.
- رقم المحل وواتساب وSentry فارغة (الأزرار المرتبطة مخفية).
- اللقطات من الـ PWA (لا جهاز/محاكي)؛ لم تُولَّد صورة الميزات 1024×500.
