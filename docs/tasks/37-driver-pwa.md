# 37: تطبيق السائق PWA (W4) ⬜

**الهدف:** SPEC-webpush §3 و§6.4. تصدير `apps/driver` كـ PWA عربية RTL تُنشر على `https://mukhdar-driver.pages.dev` (الأصل النهائي، قرار المالك)، قابلة للتثبيت على iOS 16.4+ وAndroid Chrome، بدون إشعارات (تأتي بـ T38).
**يعتمد على:** 34.
**النموذج المقترح:** Sonnet.
**على dev (بموافقتك):**
- **Cloudflare:** إنشاء مشروع Pages جديد باسم `mukhdar-driver` (ربط الـ repo، أمر البناء `pnpm --filter @mukhdar/driver run export:web`، مجلد الإخراج `apps/driver/dist`، متغيرات `EXPO_PUBLIC_SUPABASE_URL` و`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (dev) و`EXPO_PUBLIC_SHOP_PHONE/WHATSAPP`).
- **`ALLOWED_ORIGINS`** (سر Edge) += `https://mukhdar-driver.pages.dev` مع **إعادة نشر** `driver-register` و`driver-complete-registration` و`delete-account`.
- لا migration.
**الحجم:** L.

## الخطوات
1. `react-native-web` و`react-dom` بنفس إصدارات الزبون؛ `web: { bundler: 'metro', output: 'single' }`؛ سكربت `export:web` و`scripts/postexport-web.mjs` (وسوم manifest وapple-touch-icon وmeta iOS و`viewport-fit=cover` والمناطق الآمنة؛ يفشل إن لم يجد موضع التعديل).
2. `public/`: `manifest.webmanifest` (`name: سائق المخضر`، `lang: ar`، `dir: rtl`، `display: standalone`، `scope/start_url/id: /`)، أيقونات (نفس الزبون مؤقتاً، افتراض A3)، `_headers` (CSP **بلا `unsafe-inline` للسكربت** بهاش يحسبه `postexport-web.mjs`، `worker-src 'self'`، `object-src 'none'`، `frame-ancestors 'none'`، `Cache-Control` لـ `index.html` و`sw.js`). نفس التشديد على `_headers` الزبون.
3. ملفات `*.web.ts` لكل ما لا يعمل على الويب (جدول SPEC-webpush §3.1): `secureStorage`/`secureStore` فوق وحدة T34، `rtl.web.ts`، `BackHandler` لا-عملية، `expo-updates` غير مستورد؛ `lib/push.web.ts` **بديل مؤقت يرجع `unsupported`** (التنفيذ الفعلي بـ T38)؛ `NotificationsBridge` يبقى بلا عمل على الويب.
4. **بوابة التثبيت** (SPEC-webpush §3.3): دالة نقية `installState()` (`standalone | ios-browser | android-installable | other-browser | unsupported-ios`) وشاشة بالعربي تحجب التسجيل والدخول على iOS خارج الـ PWA المثبَّت، وشريط "ثبّت التطبيق" الاختياري على Android (`beforeinstallprompt`). النصوص بـ `i18n/ar.ts`.
5. مسار التسجيل والدخول والقبول والتسليم واليوم وحسابي يعمل بالويب بلا تغيير بالمنطق؛ فحص الأزرار `tel:` و`wa.me` وRTL والمناطق الآمنة.
6. CI: خطوة `export:web` للسائق، فحص أن الـ bundle لا يحوي `service_role` ولا `sb_secret_` ولا مفتاحاً خاصاً.
7. RUNBOOK (مشروع Pages الثاني، `ALLOWED_ORIGINS`، أصل ثابت)، SPEC-driver (§6 ويب)، `PREVIEW.md` (تثبيت السائق على آيفون).

## القبول
- `export:web` ينجح محلياً وبـ CI؛ الصفحة تُحمَّل بـ Chromium وWebKit بـ RTL.
- manifest صالح، أيقونات تعمل، `Cache-Control` صحيح، CSP بلا `unsafe-inline` للسكربت ولا أخطاء CSP بالـ console.
- على iOS Safari (تبويب): بوابة التثبيت تحجب التسجيل/الدخول؛ بعد التثبيت (`standalone`) يعمل المسار كاملاً.
- لا نص صريح للجلسة/سر الجهاز بتخزين المتصفح.
- Jest الحالي للسائق (231) يمر بلا تعديل جوهري، وAPK/`export:android` لم يتأثرا.

## الاختبارات
- Jest: `installState()` لكل حالة وUA، شاشة البوابة، فصل المنصات (لا استيراد native على الويب).
- Playwright (Chromium + WebKit) على `export:web`: manifest، تسجيل/دخول بحساب تجريبي، حجب iOS-browser (بمحاكاة UA/`standalone`)، لا أخطاء CSP.
- اليدوي على الآيفون يُترك لـ T39.
