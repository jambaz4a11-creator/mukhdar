# Google Play: closed test for the customer app (سوق بسماوي) / اختبار مغلق على Google Play

Written 2026-11-24 (T47). Customer app only (`apps/customer`, package `com.mukhdar.customer`).
Status: **closed test against mukhdar-dev**. A dev build must never go to Production on Play (see §6).

---

# English

## 1. Build (done by T47)

| Item | Value |
|---|---|
| EAS project | `@jafar_sadiq20/mukhdar` (ID `9774f741-7bab-47f9-a1a8-6d7cf4a31042`, not a secret, in `app.config.ts`) |
| Package name | `com.mukhdar.customer`. **Permanent once uploaded to Play.** Same value as the iOS bundle ID. |
| Profile | `closedtest` in `apps/customer/eas.json`: `.aab`, `distribution: store`, `autoIncrement`, EAS environment `preview`, `APP_ENV=preview` (points at mukhdar-dev). `production` still refuses dev. |
| Command | `cd apps/customer && npx eas-cli build -p android --profile closedtest` |
| Signing | Android keystore created and stored by EAS (remote credentials). **Download a backup:** `eas credentials -p android` -> download the existing keystore. Play App Signing is on by default; the EAS key is the *upload* key. |
| EAS env (`preview`) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL` (all public). Not set: shop phone / WhatsApp (the "call the shop" and "forgot PIN on WhatsApp" buttons stay hidden), Sentry (off), `GOOGLE_SERVICES_JSON`. |

### Push notifications (FCM) are NOT set up in this build

The app builds and runs without `google-services.json`; token registration fails quietly (it is caught in `push.ts`), so **Android testers get no push** until FCM is configured. Exact steps (owner only; nothing was guessed or created):

1. Firebase console -> create a project (or reuse the driver one) -> add an Android app with package `com.mukhdar.customer` -> download `google-services.json`.
2. `cd apps/customer && npx eas-cli env:create --environment preview --name GOOGLE_SERVICES_JSON --type file --visibility secret --value ./google-services.json` (never commit the file; it is git-ignored).
3. Firebase -> Project settings -> Service accounts -> generate a private key (FCM V1). Upload it: `eas credentials -p android` -> Google Service Account -> FCM V1.
4. Rebuild with `closedtest` (a new versionCode is picked automatically).

### Upload

Play Console -> the app -> Testing -> Closed testing -> Create release -> upload the `.aab`. Manual upload is simplest for the first release (`eas submit` needs a Play service-account key).

Personal developer accounts created after Nov 2023 must run a closed test with **at least 12 testers opted in for 14 continuous days** before they can apply for Production access. Collect the testers' Google-account emails and add them to a tester list.

## 2. Store listing (main language: Arabic)

| Field | Value |
|---|---|
| App name (max 30) | سوق بسماوي |
| Short description (max 80) | خضار وفواكه ومواد غذائية ومنظفات لباب بيتك بمدينة بسماية |
| Category | Shopping |
| Contact email | `<shop email>` (required by Play; use the same one as the privacy page) |
| Phone / website | optional; `<shop phone>` |
| Privacy policy URL | https://mukhdar-admin.jambaz4a11.workers.dev/privacy (move to the production domain at launch) |

**Full description (Arabic, max 4000):**

> سوق بسماوي: اطلب خضارك وفواكهك ومواد غذائية ومنظفات وخلّيها توصلك لباب البيت داخل مدينة بسماية.
>
> ليش سوق بسماوي؟
> • أسعار واضحة وثابتة: كل منتج بسعره، وتشوف مجموع طلبك قبل التأكيد.
> • توصيل لباب بيتك: تختار البلوك والبناية والطابق والشقة من قوائم جاهزة، بدون كتابة عنوان.
> • الدفع نقداً عند الاستلام: لا بطاقات ولا دفع بالتطبيق.
> • تتابع طلبك: من التحضير إلى وصول السائق، مع إشعارات بكل مرحلة.
> • اطلب مرة ثانية بلمسة: تعيد أي طلب سابق بسرعة.
> • قيّم طلبك بعد التسليم.
> • دخول بسيط وآمن: رقم هاتفك ورمز من 6 أرقام. ما نرسل لك أي رسالة SMS.
> • خصوصيتك محفوظة: تقدر تحذف حسابك وبياناتك من داخل التطبيق (حسابي ← حذف الحساب).
>
> الخضار والفواكه تُباع بوحدة "نص كيلو" بسعر ثابت، والأعشاب بالباقة، ومواد أخرى بالحبة أو الكيس أو العبوة.
>
> الخدمة حالياً لمدينة بسماية فقط (بغداد).

**Full description (English, optional second language):**

> Souq Basmawi: order vegetables, fruit, groceries and cleaning products and get them delivered to your door in Bismayah New City, Baghdad.
>
> - Clear fixed prices, and you see the order total before you confirm.
> - Pick your block, building, floor and apartment from lists: no typing an address.
> - Cash on delivery: no cards, no in-app payment.
> - Track your order from preparation to delivery, with notifications.
> - Reorder a previous order in one tap, and rate your order after delivery.
> - Simple sign-in with your phone number and a 6-digit PIN. We never send SMS.
> - Delete your account and data from inside the app (Account -> Delete account).
>
> Delivery is available in Bismayah only.

## 3. Graphics and screenshots

Phone screenshots (Play: 2 to 8, 16:9 or 9:16, each side 320 to 3840 px). Already taken from the live web build (`https://mukhdar-app.pages.dev`, mukhdar-dev, demo account 07000000101) at 360x640 CSS px x3 = **1080x1920**, in `docs/play-store/screenshots/`:

| # | File | Screen | Suggested caption |
|---|---|---|---|
| 1 | `02-home.png` | Home: address, search, categories, products | كل احتياجاتك بمكان واحد |
| 2 | `03-fruits.png` | Home filtered by "فواكه" | خضروات وفواكه طازجة |
| 3 | `04-product.png` | Product details with quantity | سعر ثابت لكل نص كيلو |
| 4 | `05-cart.png` | Cart | سلتك بنظرة وحدة |
| 5 | `06-checkout.png` | Confirm order: address, cash on delivery | الدفع نقداً عند الاستلام |
| 6 | `07-orders.png` | My orders: status, reorder, rate | تابع طلباتك وأعد الطلب بلمسة |
| 7 | `08-account.png` | Account: addresses, change PIN, delete account | حسابك بيدك |
| 8 | `01-sign-in.png` | Sign-in | optional |

Notes: they come from the PWA, not the native app; retake on a real device or emulator if you want native chrome. They show demo data only. Tablet screenshots were not made (the app is portrait-only and `supportsTablet` is off; optional).

Still needed from the owner (not generated): the **feature graphic, 1024x500 PNG/JPG** (required by Play), and the **512x512 icon** (use `apps/customer/public/icons/icon-512.png`, the brand icon; `pnpm brand:icons` regenerates it).

## 4. Data safety form (Play Console -> App content -> Data safety)

Based on the code, `docs/SPEC-customer.md` and the live privacy policy (`/privacy`). Answer exactly this.

**Data collection and security**

- Does the app collect or share any of the required user data types? **Yes**
- Is all collected data encrypted in transit? **Yes** (HTTPS only)
- Can users request data deletion? **Yes**: in-app (Account -> Delete account) and on the web: https://mukhdar-admin.jambaz4a11.workers.dev/delete-account
- Account creation: username + password style (phone number + PIN). No third-party / OAuth sign-in.

**Data types.** Shared = **No** on every row. (Service providers that only process data for us, Supabase hosting and Expo's push relay, are not "sharing" under Play's definition.)

| Category -> type | Collected | Optional? | Purpose |
|---|---|---|---|
| Personal info -> Name | Yes | Required | App functionality, Account management |
| Personal info -> Phone number | Yes | Required | App functionality, Account management |
| Personal info -> Address | Yes (delivery address chosen from lists, not GPS) | Required to order | App functionality |
| Financial info -> Purchase history | Yes (orders and amounts; payment is cash, no card data) | Required to order | App functionality |
| Messages / App activity -> Other user-generated content | Yes (order and address notes, rating comment) | Optional | App functionality |
| Device or other IDs (push token) | Yes, **only after FCM is set up and the user allows notifications** | Optional | App functionality (order status) |
| App activity -> App interactions | **No** (no analytics SDK) | | |
| App info and performance -> Crash logs / Diagnostics | **No in this build** (Sentry is off: `EXPO_PUBLIC_SENTRY_DSN` empty). If Sentry is turned on later: declare Crash logs + Diagnostics, collected, not shared, purpose Analytics / App functionality. | | |
| Location (precise or approximate), Contacts, Photos and videos, Audio, Files, Calendar, Health, Web browsing, Search history | **No** | | |

Other App-content declarations: Ads **No**. Financial features **No**. Health **No**. Government app **No**. News app **No**. Target audience **18+** (the privacy policy says the app is not directed at under-13s; choosing 18+ avoids the Families policy). COVID-19 apps **No**.

## 5. Content rating (IARC questionnaire)

Category: **All other app types** (a shopping app; not a game, social or news app).

- Violence, blood, fear/horror, sexual content, nudity: **No** to all.
- Profanity / crude humor: **No**.
- Controlled substances (drugs, alcohol, tobacco) shown or promoted: **No** (the catalog is vegetables, fruit, groceries and cleaning products).
- Gambling or simulated gambling: **No**.
- Users can interact or exchange content with each other: **No** (notes and ratings are visible only to the shop; no chat, no public reviews).
- Shares user location with others: **No**.
- Digital goods purchases: **No** (physical goods, cash on delivery).
- Unrestricted web access: **No**.

Expected result: **Everyone / PEGI 3 / IARC 3+**. Submit the result Play shows.

## 6. App access (instructions for Google reviewers)

Play Console -> App content -> App access -> "All or some functionality is restricted" -> add instructions:

```
The app requires sign-in. There is no SMS or OTP; sign-in is phone number + 6-digit PIN.

Reviewer demo account (customer role only):
  Phone number: <DEMO PHONE NUMBER, e.g. 07000000101>
  PIN:          <enter the PIN in Play Console only; it is NOT stored in this repository>

Steps: open the app -> enter the phone number (without +964) and the PIN -> "دخول".
The home screen shows the product catalog. Add items to the cart -> Cart -> continue ->
choose the saved address -> "تأكيد الطلب" (cash on delivery; no payment details are requested).
Account -> "حذف الحساب" deletes an account (please do not delete the demo account).
The app is Arabic, right-to-left. Delivery is limited to Bismayah New City, Baghdad.
This build points at a test backend (mukhdar-dev) with test data only.
```

Rules: the PIN goes only into the Play Console form (owner), never into the repo (it is public). Before launch rotate it (`pnpm demo:rotate -- --remote`, RUNBOOK §6) and use a dedicated reviewer account on the **production** backend. Never submit a `preview` / `closedtest` build to Production.

## 7. Before Production (not part of T47)

Production Supabase project (RUNBOOK §17), production EAS environment and the `production` profile (its guard blocks dev), production privacy URL, reviewer account on production, FCM, shop phone / WhatsApp variables, 12 testers x 14 days, feature graphic, store account details in the owner's name (`docs/tasks/24-release.md`).

---

# بالعربية

## ١. البناء (منجز بـ T47)

| البند | القيمة |
|---|---|
| مشروع EAS | `@jafar_sadiq20/mukhdar` (المعرّف `9774f741-7bab-47f9-a1a8-6d7cf4a31042`، ليس سراً، ثابت بـ `app.config.ts`) |
| اسم الحزمة | `com.mukhdar.customer`. **لا يتغيّر نهائياً بعد أول رفع على Play.** هو نفسه معرّف iOS. |
| الـ profile | `closedtest` بـ `apps/customer/eas.json`: ملف `.aab`، توزيع `store`، `autoIncrement`، بيئة EAS اسمها `preview`، `APP_ENV=preview` (يشير لـ mukhdar-dev). profile الإنتاج ما زال يرفض dev. |
| الأمر | `cd apps/customer && npx eas-cli build -p android --profile closedtest` |
| التوقيع | أنشأ EAS مفتاح التوقيع وخزّنه عنده. **نزّل نسخة احتياطية:** `eas credentials -p android`. Play App Signing مفعّل افتراضياً ومفتاح EAS هو مفتاح الرفع. |
| متغيرات EAS (`preview`) | `EXPO_PUBLIC_SUPABASE_URL` و`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` و`EXPO_PUBLIC_PRIVACY_URL` و`EXPO_PUBLIC_TERMS_URL` (كلها عامة). غير مضبوطة: رقم المحل وواتساب (أزرار "اتصل بالمحل" و"نسيت الرمز" تبقى مخفية)، Sentry (مطفأ)، `GOOGLE_SERVICES_JSON`. |

### الإشعارات (FCM) غير مفعّلة بهذا البناء

التطبيق يُبنى ويعمل بدون `google-services.json`، وتسجيل الرمز يفشل بصمت، فـ **المختبرون على أندرويد لن تصلهم إشعارات** حتى يُضبط FCM. الخطوات (على المالك؛ لم يُنشأ ولم يُخمَّن شيء):

1. Firebase ← مشروع (أو مشروع السائق نفسه) ← إضافة تطبيق Android بالحزمة `com.mukhdar.customer` ← تنزيل `google-services.json`.
2. `cd apps/customer && npx eas-cli env:create --environment preview --name GOOGLE_SERVICES_JSON --type file --visibility secret --value ./google-services.json` (لا ترفع الملف لـ git؛ هو مُتجاهل).
3. Firebase ← Project settings ← Service accounts ← توليد مفتاح خاص (FCM V1) ← رفعه: `eas credentials -p android` ← Google Service Account ← FCM V1.
4. أعد البناء بـ `closedtest` (يُرفع versionCode تلقائياً).

### الرفع

Play Console ← التطبيق ← Testing ← Closed testing ← Create release ← ارفع ملف `.aab` يدوياً.

الحسابات الشخصية المنشأة بعد نوفمبر 2023 تحتاج اختباراً مغلقاً بـ **12 مختبراً على الأقل لمدة 14 يوماً متواصلة** قبل التقديم على الإنتاج. اجمع إيميلات Google للمختبرين وأضفهم لقائمة مختبرين.

## ٢. صفحة المتجر

| الحقل | القيمة |
|---|---|
| اسم التطبيق (30 حرفاً) | سوق بسماوي |
| الوصف القصير (80 حرفاً) | خضار وفواكه ومواد غذائية ومنظفات لباب بيتك بمدينة بسماية |
| التصنيف | Shopping (التسوق) |
| إيميل التواصل | `<إيميل المحل>` (إلزامي، نفس المكتوب بصفحة الخصوصية) |
| رابط سياسة الخصوصية | https://mukhdar-admin.jambaz4a11.workers.dev/privacy (يُنقل لنطاق الإنتاج عند الإطلاق) |

الوصف الكامل بالعربية (وبالإنجليزية اختيارياً) بالقسم الإنجليزي أعلاه؛ انسخه كما هو.

## ٣. اللقطات والرسومات

اللقطات الثمانية جاهزة بـ `docs/play-store/screenshots/` بمقاس 1080×1920 من نسخة الويب الحية (حساب وبيانات تجريبية فقط)، والترتيب والشرح بالجدول أعلاه. هي من الـ PWA مو من التطبيق الأصلي؛ صوّر من جهاز حقيقي إن أردت. **مطلوب منك ولم يُولَّد:** صورة الميزات (Feature graphic) 1024×500 (إلزامية)، وأيقونة 512×512 (`apps/customer/public/icons/icon-512.png`).

## ٤. نموذج أمان البيانات (Data safety)

الجدول الإنجليزي أعلاه هو الجواب. باختصار: **نعم** نجمع بيانات؛ كلها مشفّرة أثناء النقل (HTTPS)؛ **نعم** يوجد حذف (من داخل التطبيق ورابط الويب `/delete-account`). المجموع: الاسم، رقم الهاتف، العنوان (اختيار من قوائم لا GPS)، سجل الطلبات (الدفع كاش بلا بيانات بطاقة)، الملاحظات والتعليق (اختيارية)، ورمز الإشعارات (فقط بعد تفعيل FCM وموافقة المستخدم). **لا** موقع، ولا جهات اتصال، ولا صور، ولا تحليلات، ولا إعلانات، ولا مشاركة مع أطراف ثالثة. تقارير الأعطال: لا بهذا البناء (Sentry مطفأ)؛ إن فُعِّل لاحقاً حدّث النموذج.

## ٥. تصنيف المحتوى

الفئة: **All other app types**. كل أسئلة العنف والجنس والألفاظ والمخدرات والكحول والقمار والتفاعل بين المستخدمين ومشاركة الموقع: **لا**. شراء سلع رقمية: **لا** (سلع مادية بالكاش). المتوقع: **للجميع (3+)**.

## ٦. الوصول للتطبيق (لمراجعي Google)

انسخ نص التعليمات الإنجليزي بالقسم 6 أعلاه. رقم الحساب التجريبي: `<الرقم التجريبي، مثل 07000000101>`. **الرمز (PIN) يُكتب في نموذج Play Console فقط ولا يُكتب بالـ repo أبداً** (الـ repo عام). قبل الإطلاق دوّر الرمز (`pnpm demo:rotate -- --remote`) واستعمل حساب مراجع على الإنتاج. لا ترفع بناء `preview` أو `closedtest` للإنتاج.
