# SPEC-driver: تطبيق السائق (`apps/driver`، Expo)

> **الحالة: معتمد من المالك (2026-11-19)، بقرارات "قرارات المالك" أدناه.** تحل محل النسخة السابقة التي كانت تصف تطبيقاً خارجياً. **المطوّر الخارجي أُلغي نهائياً.**
> **قرار يتغيّر:** تطبيق السائق صار **داخل هذا الـ repo** (`apps/driver`) بدل مطوّر خارجي. عند الموافقة تُحدَّث معه بنفس الـ PR الأول للتنفيذ: `CLAUDE.md` (فقرة "تطبيق السائق خارجي")، `docs/tasks/00-README.md` و`21-driver-app.md`، مقدمة `DRIVER-API.md` (يبقى عقد الدوال، ويصير مرجعاً داخلياً)، وSPEC-backend §1/§4/§5/§8، وSPEC-admin (صفحة جديدة §2.10).
> التصميم المعتمد: [تصميم تطبيق السائق](https://claude.ai/artifact/Q77gRRiwG3fT8Ju4DSeixY) (9 شاشات). عقد الدوال الموجودة: [DRIVER-API.md](DRIVER-API.md).

---

## 1) الهدف

تطبيق موبايل للسائق (عربي RTL، نفس هوية تطبيق الزبون: أخضر `#1F6B3A`، خط IBM Plex Sans Arabic، أزرار كبيرة ≥ 52px لأنه يُستخدم أثناء المشي/القيادة) يغطي:

1. **تسجيل ذاتي للسائق** بالاسم والرقم ← طلب **معلّق** بلا أي حساب ← موافقة الأدمن بعد مكالمة ← **نفس الجهاز فقط** يختار الرمز ← حساب سائق فعّال.
2. **التوصيل:** الطلبات الجاهزة وقبولها (أول سائق يفوز)، طلباتي، تفاصيل الطلب بالعنوان الكامل والاتصال بالزبون، "بالطريق" و"تم التوصيل"، سجل اليوم بالكاش، وحسابي.
3. **إشعار** عند جاهزية طلب (موجود بالـ backend)، وعند الموافقة على طلب التسجيل.

**النشر:** Android APK أولاً (EAS Build، `buildType: apk`، توزيع داخلي بلا متجر)؛ iOS Ad Hoc لاحقاً (يحتاج حساب Apple Developer وتسجيل UDID الأجهزة). لا متجر بالنسخة الأولى.

### قصص المستخدم ومعايير القبول

| # | القصة | القبول |
|---|---|---|
| U1 | كسائق جديد أسجّل باسمي ورقمي | الطلب يُحفظ `pending`؛ لا حساب Auth يُنشأ؛ التطبيق يعرض "طلبك وصل للمحل" |
| U2 | كأدمن أشوف طلبات السواق وأوافق أو أرفض | صفحة "طلبات السواق" للأدمن فقط (aal2)؛ كل قرار يُكتب بـ `admin_audit` |
| U3 | كسائق موافَق عليه أختار رمزي من نفس الجهاز | الرمز + تأكيده ← حساب `driver` فعّال بلا `must_change_pin` ← دخول مباشر. جهاز آخر (بلا سر الجهاز) لا يقدر |
| U4 | كسائق معلّق أو مرفوض ما أقدر أدخل | لا حساب Auth موجود أصلاً ← الدخول يفشل؛ شاشة الانتظار تعرض الحالة |
| U5 | كسائق أدخل بعدها برقمي ورمزي فقط | `signInWithPassword` بلا TOTP (aal1 يكفي للسائق، موجود) |
| U6 | كسائق أشوف الطلبات الجاهزة وأقبل واحد | `accept_order`؛ إن سبقني غيري: "قبله سائق ثاني" وتحديث القائمة |
| U7 | كسائق أوصل الطلب | تفاصيل كاملة، اتصال/واتساب، "بالطريق" ثم "تم التوصيل واستلمت المبلغ" (تأكيد مزدوج) |
| U8 | كسائق أعرف الكاش اللي بيدي اليوم | مجموع `total_iqd` لطلباتي المسلّمة اليوم بتوقيت بغداد، وعددها، وقائمتها. **سيتغيّر (قرار المالك 2026-11-22، [SPEC-cash](SPEC-cash.md) §5، T42):** الكاش = منذ آخر تسليم للمحل (لا منذ منتصف الليل)، من دالة بقاعدة البيانات، مع سجل التسليمات وإشعار بعد كل تسليم |
| U9 | كسائق نسيت رمزي | "اتصل بالمحل / واتساب" ← الأدمن يعيد الضبط (`admin-reset-pin` الموجودة) ← رمز مؤقت ← تغيير إجباري |

---

## 2) الشاشات (مطابقة للتصميم المعتمد)

```
app/
  _layout.tsx                 حارس الحالة (انظر §2.1)
  auth/login.tsx              Login
  auth/register.tsx           Register
  auth/pending.tsx            Pending (ومعها حالات: مرفوض، منتهي)
  auth/set-pin.tsx            ChangePin "اختار رمزك" (بعد الموافقة)
  auth/change-pin.tsx         تغيير إجباري لرمز مؤقت من الأدمن (must_change_pin)
  auth/not-driver.tsx         "حسابك غير مفعّل كسائق" (تحديث + خروج)
  auth/offline.tsx            "ماكو اتصال" (إعادة المحاولة + خروج)، R1 M2
  (tabs)/index.tsx            Main "الطلبات الجاهزة"
  (tabs)/my-orders.tsx        MyOrders "طلباتي"
  (tabs)/today.tsx            Today "سجل اليوم"
  (tabs)/account.tsx          Account "حسابي"
  account/change-pin.tsx      تغيير الرمز (الحالي + الجديد + التأكيد)
  order/[id].tsx              OrderDetail
```

### 2.1 حارس الحالة (`_layout.tsx`)
بالترتيب عند كل تشغيل ورجوع للتطبيق:
1. **جلسة موجودة:** اقرأ `profiles` (`role, is_active, must_change_pin, full_name, phone`).
   - `must_change_pin` ← `auth/change-pin` (لا تخطي، فقط خروج).
   - `role ≠ 'driver'` أو `!is_active` ← `auth/not-driver`.
   - غير ذلك ← `(tabs)`.
   - فشل تحديث الجلسة برفض قاطع من الخادم (HTTP 400/401، أو `refresh_token_not_found`/`refresh_token_already_used`/`session_not_found`) ← خروج محلي ← `auth/login`.
   - فشل تحديث الجلسة **بسبب الشبكة** عند التشغيل (`AuthRetryableFetchError`، 5xx، انقطاع): **لا خروج**، الجلسة تبقى محفوظة بالجهاز ← `auth/offline` "ماكو اتصال" مع "إعادة المحاولة" (وتُعاد المحاولة تلقائياً عند كل رجوع للتطبيق) وزر خروج (قرار المالك 2026-11-20، R1 M2).
2. **لا جلسة، ويوجد طلب تسجيل محفوظ بالجهاز** (`request_id` + سر الجهاز بـ SecureStore) ← `auth/pending` (التي تتحول لـ `set-pin` عند `approved`).
3. غير ذلك ← `auth/login`.

### 2.2 الدخول (Login)
- رقم الهاتف (`07XXXXXXXXX`، أرقام عربية مقبولة) + الرمز (6 أرقام، زر إظهار) ← `signInWithPassword(phonePinCredentials(phone, pin))` من `packages/shared`.
- الأخطاء: `invalid_credentials` ← "الرقم أو الرمز غير صحيح"؛ 429 ← "محاولات كثيرة، انتظر قليلاً"؛ الشبكة ← "صار خلل، حاول مرة ثانية".
- "سائق جديد؟ سجّل هنا" ← Register.
- "نسيت الرمز؟" ← اتصال بالمحل (`tel:`) وواتساب المحل (`wa.me`) من `EXPO_PUBLIC_SHOP_PHONE` / `EXPO_PUBLIC_SHOP_WHATSAPP` (كتطبيق الزبون). التصميم يقول "اتصل بمدير المحل"؛ نضيف واتساب بجانبه لأنه مسار إعادة الضبط المعتمد (ADR 0001).

### 2.3 التسجيل (Register)
- الاسم (2..80 حرفاً بعد القص) والرقم.
- عند "إرسال الطلب":
  1. يولّد التطبيق **سر الجهاز**: 32 بايت عشوائية (`expo-crypto` `getRandomBytesAsync`) بترميز base64url، ويحفظه بـ `expo-secure-store` (Keychain/Keystore) **قبل** الإرسال.
  2. يطلب إذن الإشعارات (اختياري، مع شرح "حتى نبلغك أول ما يوافقون") وإن سُمح يأخذ رمز Expo.
  3. `POST functions/v1/driver-register` بـ `{ full_name, phone, device_secret, push_token? }` (§4.2).
  4. `201 { request_id }` ← يحفظ `request_id` بـ SecureStore ← Pending.
- الأخطاء بالعربي (من `packages/shared/errors.ts`): `PHONE_INVALID`، `NAME_INVALID`، `PHONE_TAKEN` ("الرقم مسجّل عدنا. تواصل مع المحل حتى يفعّلك كسائق")، `REQUEST_EXISTS` ("أكو طلب لهذا الرقم بانتظار الموافقة")، `RATE_LIMITED`، `TOO_MANY_PENDING`، `REGISTER_FAILED`.

### 2.4 بانتظار الموافقة (Pending)
- يعرض الاسم والرقم المحفوظين محلياً، وشارة "بانتظار الموافقة"، وزر "تحقق من الموافقة".
- **التحديث:** RPC `driver_request_status` (§4.3) عند فتح الشاشة، كل 30 ثانية والشاشة ظاهرة، عند الرجوع للتطبيق، عند الضغط، وعند وصول إشعار `driver_request_approved`.
- الحالات:
  - `pending` ← كما هي.
  - `approved` ← `set-pin`.
  - `rejected` ← "ما انقبل طلبك. للاستفسار اتصل بالمحل" + "طلب جديد" (يمسح البيانات المحلية ← Register).
  - `expired` ← "انتهت مدة الموافقة، سجّل من جديد" + "طلب جديد".
  - `completed` (اكتمل من هذا الجهاز سابقاً ثم انقطع قبل الدخول) ← يمسح البيانات المحلية ← Login.
  - `not_found` (سر لا يطابق أو حُذف الطلب) ← يمسح البيانات المحلية ← Register.
- رابط صغير "إلغاء وتسجيل برقم ثاني" (يمسح البيانات المحلية فقط؛ الطلب القديم يبقى للأدمن يرفضه أو ينتهي).

### 2.5 اختيار الرمز بعد الموافقة (set-pin، تصميم ChangePin)
- "وافق المحل على طلبك" ← الرمز + "أعد إدخال الرمز" ← `validatePin(pin, phone)` بالتطبيق (نفس القواعد) + تطابق الحقلين.
- `POST functions/v1/driver-complete-registration` بـ `{ request_id, device_secret, pin }` (§4.4).
- `201` ← `signInWithPassword` بنفس الرقم والرمز ← مسح `request_id` وسر الجهاز من SecureStore ← تسجيل رمز الإشعارات (`register_push_token`) ← `(tabs)`.
- `409 PHONE_TAKEN` أو `REQUEST_NOT_APPROVED` ← يعيد قراءة الحالة؛ `completed` ← Login برسالة "حسابك جاهز، سجّل دخولك".
- لا يرسل التطبيق الرمز لأي مكان غير هذه الدالة ثم GoTrue.

### 2.6 الطلبات الجاهزة (Main)
- `available_orders(20)` (الموجودة؛ `ready` غير المعيَّنة، الأقدم أولاً).
- البطاقة: رقم الطلب، "جاهز من N دقيقة" (فوق 60 دقيقة ساعات ثم أيام: "جاهز من ساعتين"، "جاهز من 4 أيام"؛ `formatElapsedAr` بـ `packages/shared`، 2026-11-22)، شرائح **بلوك** و**بناية**، "N منتجات" (`line_count`، عدد البنود المختلفة، D13)، "تستلم كاش: X د.ع" (`total_iqd`، `formatIqd`)، زر "قبول الطلب".
- **انحراف عن التصميم:** التصميم يعرض الطابق والشقة قبل القبول؛ `available_orders` لا يرجعهما قصداً (خصوصية الزبون، DRIVER-API §3.1). النسخة الأولى تعرض البلوك والبناية فقط (سؤال مفتوح 1).
- قبول ← `accept_order(id)`: النجاح ← `order/[id]`؛ `ORDER_NOT_AVAILABLE` ← البطاقة باهتة بعبارة "قبله سائق ثاني" ثم تُحذف بالتحديث التالي؛ `NOT_ALLOWED` ← إعادة فحص الملف الشخصي (§2.1).
- التحديث: سحب للتحديث، كل 30 ثانية والشاشة ظاهرة، عند الرجوع للتطبيق، وعند إشعار `new_order`. الشارة بالرأس = عدد الطلبات.
- قائمة فارغة: "ماكو طلبات جاهزة هسه. نبلغك أول ما يجهز طلب."

### 2.7 طلباتي (MyOrders)
- الطلبات المعيَّنة لي وليست نهائية (`preparing`/`ready`/`out_for_delivery`)، الأقدم أولاً (استعلام DRIVER-API §4).
- البطاقة: الرقم، الحالة ("بالطريق" أخضر؛ `ready` = "مقبول، بعده بالمحل"؛ `preparing` = "بانتظار التحضير")، العنوان الكامل بـ `formatAddress` (مثل `بلوك A3 · بناية 12 · الطابق G · شقة 4`)، اسم الزبون، الكاش.
- **Realtime** على `orders` بفلتر `driver_id=eq.<me>` (لكل شاشة اشتراك **باسم قناة فريد** وتنظّفه عند الإغلاق؛ supabase-js يرجع القناة المنضمّة نفسها لنفس الاسم و`.on()` بعد `subscribe()` يرمي، R2 C1) + إعادة جلب عند الرجوع للتطبيق وإعادة الاتصال وكل 30 ثانية (النقل لسائق آخر لا يصل بـ Realtime، DRIVER-API §5). طلب يختفي أو يصير `cancelled` يُزال برسالة قصيرة.

### 2.8 تفاصيل الطلب (OrderDetail)
- الرأس: "الطلب #N"، "قبلته الساعة HH:MM" (`assigned_at` بتوقيت بغداد)، شارة الحالة.
- **العنوان** بمربعات كبيرة: البلوك، البناية، الطابق (`0` ← **G**؛ مفقود ← يُخفى المربع)، الشقة؛ وملاحظة العنوان إن وُجدت. نصوص اللقطة تُعرض كما هي بلا تحقق (عناوين قديمة ممكنة، DRIVER-API "Changes 2026-11-19"). لقطة زبون محذوف (قطاع ووحدة فقط) ← "حساب محذوف" وتُخفى أزرار الاتصال.
- **الزبون:** الاسم، الرقم، زر اتصال (`tel:0…`) وزر واتساب (`https://wa.me/964…`).
- **المنتجات:** الاسم والكمية بـ `formatQuantity` ("نص كيلو"، "1.5 كيلو"، "2 باقة")، ثم **ملاحظة الزبون** (`orders.note`) بصندوق مميز.
- **تستلم كاش:** `total_iqd` بخط كبير.
- **الزر الثابت أسفل الشاشة حسب الحالة:**
  - `preparing` ← معطّل "بانتظار التحضير".
  - `ready` ← "استلمت الطلب، بالطريق" ← `set_order_status(id, 'out_for_delivery')`.
  - `out_for_delivery` ← "تم التوصيل واستلمت المبلغ" ← نافذة تأكيد ثانية تعرض المبلغ ← `set_order_status(id, 'delivered')`.
  - `delivered`/`cancelled` ← لا أزرار.
- أخطاء `set_order_status`: `INVALID_TRANSITION` (تغيّرت من اللوحة) ← إعادة جلب؛ `NOT_ALLOWED` ← "الطلب ما بقى إلك" ← طلباتي.
- "مشكلة بالطلب؟ اتصل بالمحل" (السائق لا يلغي).

### 2.9 سجل اليوم (Today)
> **استُبدل بـ T42 (2026-11-22)** بـ [SPEC-cash](SPEC-cash.md) §5. المنفَّذ الآن: "الكاش اللي بيدك" (أو "المطلوب تسليمه للمحل" مع "أجرة التوصيل إلك، ما تنحسب" إن كانت الأجرة تبقى عند السائق) = `driver_cash_summary()` منذ آخر تسليم (لا مجموع بالتطبيق، ولا تصفير منتصف الليل)، مع "عن N طلب · من آخر تسليم …" أو "ما سلّمت كاش بعد"؛ "توصيلات اليوم" = العدد بيوم بغداد؛ القائمة = الطلبات اللي فلوسها بيده (`cash_handover_id is null`، حد 200، عرض فقط)؛ رابط "سجل التسليمات" ← `cash/history` (`my_cash_handovers`، صفحات 20 بالتمرير: الوقت، "استلم المحل X"، "المطلوب Y" إن اختلف، شارة نقص/زيادة، الملاحظة كنص صرف، "استلمها <الاسم الأول>"، "تعدّل")؛ التحديث بالفتح والرجوع للتطبيق وكل 30 ثانية وبالسحب وبإشعار `cash_handover`؛ الإشعار يفتح `/today` (عنوان التبويب الفعلي، كبقية التبويبات)؛ وحذف الحساب برصيد ← "عندك كاش ما سلّمته للمحل (X د.ع). سلّمه أولاً" (المبلغ من `driver_cash_summary` لأن رد 409 لا يحمله). الوصف التالي يخص ما سبق T42 (نص بالأصل، يبقى مرجعاً لتصميم الشاشة والتاريخ بيوم بغداد).

- **اليوم** = `[00:00, 24:00)` بتوقيت `Asia/Baghdad` (UTC+3 ثابت، بلا توقيت صيفي) محسوباً بدالة مشتركة `baghdadDayRange(now)` بـ `packages/shared` (باختبارات).
- الاستعلام: `orders` حيث `driver_id = me` و`status = 'delivered'` و`delivered_at` ضمن اليوم، مرتب تنازلياً (قراءة مباشرة بـ RLS الموجودة؛ لا دالة جديدة).
- بطاقتان: **"الكاش اللي بيدك"** = Σ `total_iqd` (يشمل أجرة التوصيل: السائق يستلم المجموع كاملاً؛ التسوية مع المحل خارج التطبيق)، و**"توصيلات اليوم"** = العدد.
- القائمة: `#N · بلوك X · بناية Y`، الوقت، المبلغ. ملاحظة "الأرقام تتصفّر كل يوم الساعة 12 بالليل بتوقيت بغداد."
- طلبات اليوم قليلة (عشرات)، فالمجموع بالتطبيق مقبول (DRIVER-API §4). حد أمان: 200 صف.

### 2.10 حسابي (Account)
- الاسم، الرقم، "سائق".
- "تغيير الرمز السري" ← الحالي + الجديد + التأكيد ← `validatePin` والجديد ≠ الحالي ← `signInWithPassword` بالحالي ← `updateUser({ password })` ← `signOut({ scope: 'others' })` (نفس مسار ADR 0001 بلوحة الأدمن وتطبيق الزبون).
- "اتصل بالمحل" (`tel:`) و"واتساب المحل".
- "تسجيل الخروج": حذف صف `push_tokens` لهذا الجهاز ← إلغاء اشتراكات Realtime ← `signOut({ scope: 'local' })`. **قرار المالك 2026-11-21 (R2 L2):** الخروج من **هذا الجهاز فقط** (لا `global`)؛ الهاتف المفقود يعالجه الأدمن (تعطيل الحساب أو إعادة ضبط الرمز، وكلاهما يُخرج من كل الأجهزة). **كل مسارات الخروج** (حسابي، "ماكو اتصال"، "غير سائق"، الرمز الإجباري) تمر بدالة واحدة `signOut` بـ `features/auth/store.ts` (R2 M2). بلا شبكة لا يتعطل الخروج: يُبطَل رمز الجهاز (`unregisterForNotificationsAsync`) فتتوقف الإشعارات فوراً، ويُخزَّن الرمز للحذف المؤجَّل من الخادم ويُعاد حذفه عند أول جلسة (تشغيل أو رجوع للتطبيق)، وExpo يجيب `DeviceNotRegistered` فيحذفه `push-dispatch` أيضاً.
- **"حذف الحساب"** (إضافة على التصميم؛ مطلوب لـ iOS حسب CLAUDE.md): `delete-account` الموجودة؛ `ACTIVE_ORDER` ← "عندك طلب ما خلص، كمله أو كلّم المحل". زر ثانوي بأسفل الصفحة بتأكيد.

### 2.11 الإشعارات بالتطبيق
- قناة Android **`orders`** (أهمية عالية، صوت) عند التشغيل.
- إذن الإشعارات: عند التسجيل (اختياري، §2.3) وبعد أول دخول. رفض الإذن ← شريط تنبيه بالطلبات الجاهزة "الإشعارات مطفية، راح تفوتك طلبات" مع رابط الإعدادات.
- `register_push_token(token, platform, 'expo')` عند كل تشغيل بجلسة سائق فعّالة وبعد الدخول وتغيير الرمز المؤقت (DRIVER-API §3.4).
- فتح الإشعار حسب `data.type`: `new_order` ← الجاهزة؛ `ready`/`assigned` ← `order/[id]`؛ `unassigned`/`cancelled` ← طلباتي + تحديث؛ `driver_request_approved` ← Pending (تتحول لـ set-pin).

---

## 3) التسجيل: تصميم الأمان

**الفكرة:** الطلب لا يمنح أي دخول. الأدمن يتحقق من الرقم **بمكالمة** (RUNBOOK). بعد الموافقة، **من يملك سر الجهاز** فقط يقدر يحوّل الطلب لحساب. الحساب يُنشأ بالخادم (`auth.admin.createUser`) لأن التسجيل العام مطفأ.

| التهديد | الحماية |
|---|---|
| إغراق قائمة الأدمن بطلبات وهمية | حد لكل IP (10/ساعة) ولكل رقم (3/يوم)، وطلب معلّق واحد لكل رقم، وسقف عام 50 طلباً معلّقاً (`TOO_MANY_PENDING`)، والأدمن يتصل قبل الموافقة |
| شخص يسجّل برقم غيره | المكالمة قبل الموافقة (RUNBOOK)؛ صاحب الرقم الحقيقي يرد وينكر |
| جهاز آخر يكمل طلباً موافَقاً عليه | سر الجهاز 256 بت، يُخزَّن بالخادم **SHA-256 فقط**؛ التطابق بمقارنة ثابتة الزمن؛ لا يمر بالسجلات |
| تخمين `request_id` | بلا السر لا فائدة؛ الدالة ترجع `not_found` لأي عدم تطابق (لا تفرّق) |
| موافقة قديمة تُستغل بعد شهور | الموافقة صالحة **7 أيام**، بعدها `expired` |
| تسجيل مكرر بالسباق (ضغطتان) | قفل صف الطلب؛ الانتقال `approved → completed` شرطي؛ رقم واحد = حساب واحد (GoTrue + `profiles_phone_key`) |
| بيانات شخصية لطلبات قديمة | حذف الطلبات `rejected`/`expired`/`completed` بعد 30 يوماً (`pg_cron` اليومي الموجود)؛ رمز الإشعار يُمسح عند أي قرار |
| الرقم مسجّل أصلاً (زبون) | `PHONE_TAKEN` كدالة `signup` الحالية (نفس مستوى كشف الأرقام)؛ الأدمن يرقّيه بالمسار الموجود (`set_user_role`) **بعد إعادة ضبط رمزه** (قاعدة بقاعدة البيانات: `PIN_RESET_REQUIRED`، R1 H1) |
| قفل رقم سائق بطلبات فاسدة | حد الرقم (3/24 ساعة) لا يُستهلك إلا بطلب **اجتاز الفحص** (جسم واسم ورقم وسر صالحة)؛ الطلب الفاسد يُحدّه حد الـ IP وحده (R1 M3) |
| نص من مجهول على أجهزة الأدمن | إشعار الأدمن عام ("طلب سائق جديد، افتح طلبات السواق") بلا الاسم ولا الرقم؛ الاسم داخل اللوحة فقط (R1 M4) |
| كشف أرقام بالتسجيل | `PHONE_TAKEN` و`REQUEST_EXISTS` يكشفان أن للرقم حساباً أو طلباً مفتوحاً (الأول كـ `signup`، والثاني جديد). مقبول ومحدود بـ 10/ساعة لكل IP و3/يوم لكل رقم (R1 L3) |

**الرمز:** يختاره السائق بنفسه، فلا `must_change_pin`. `validatePin` بالتطبيق **وبالخادم**. لا يُخزَّن ولا يُسجَّل.

---

## 4) تغييرات الـ backend (كل تغيير بقاعدة البيانات بـ migration جديدة، تُطبَّق بـ `pnpm sb db push` على dev فقط)

### 4.1 قائمة كاملة بتغييرات قاعدة البيانات

| # | التغيير | التفاصيل |
|---|---|---|
| D1 | جدول `public.driver_requests` | `id uuid pk default gen_random_uuid()`، `full_name text not null` (2..80 بعد التنظيف)، `phone text not null` (قيد `^9647[0-9]{9}$`)، `device_secret_hash text not null` (hex SHA-256، 64 حرفاً)، `status text not null default 'pending'` (`pending`/`approved`/`rejected`/`completed`)، `push_token text null` (Expo فقط، نفس فحص الصيغة)، `created_at`، `decided_at`، `decided_by uuid → profiles on delete set null`، `decision_note text null` (≤ 300، داخلي للأدمن)، `approved_until timestamptz null` (= `decided_at + 7 days`)، `user_id uuid → profiles on delete set null`، `completed_at`. فهرس فريد جزئي `(phone) where status in ('pending','approved')` (طلب مفتوح واحد لكل رقم). RLS مفعّل **بلا أي سياسة**؛ `revoke all` من `anon`/`authenticated`؛ الوصول عبر الدوال فقط. `expired` **محسوبة** (`approved` و`approved_until < now()`)، لا تُخزَّن |
| D2 | حد المعدل `private.driver_request_rate_limits` + `public.driver_request_rate_hit(p_ip text, p_phone text) → boolean` | نفس تصميم `signup_rate_hit` (تجزئة، كل محاولة تُحسب): 10/ساعة لكل IP، 3/24 ساعة لكل رقم. **service_role فقط** |
| D3 | `public.submit_driver_request(p_phone, p_full_name, p_secret_hash, p_push_token) → uuid` | service_role فقط. ينظّف الاسم (نفس منظّف الأسماء الحالي)؛ قفل استشاري لكل رقم؛ رقم له حساب ← `PHONE_TAKEN`؛ طلب مفتوح لنفس الرقم: **بنفس الـ hash** ← يرجع نفس `id` (إعادة إرسال آمنة)، بغيره ← `REQUEST_EXISTS`؛ عدد `pending` ≥ 50 ← `TOO_MANY_PENDING`؛ يُدرج ويكتب إشعار `admins_only` **عام** "طلب سائق جديد، افتح طلبات السواق" بلا اسم ولا رقم (R1 M4؛ `data.type = 'driver_request'`) |
| D4 | `public.driver_request_status(p_request_id uuid, p_device_secret text) → text` | **`anon` و`authenticated`** (الجهاز بلا حساب). SECURITY DEFINER، `search_path = ''`. يحسب SHA-256 للسر ويقارن؛ يرجع `pending`/`approved`/`rejected`/`expired`/`completed`، أو `not_found` لأي عدم تطابق أو سر بطول خاطئ. لا يرجع أي بيانات أخرى |
| D5 | `public.list_driver_requests(p_status text default 'pending', p_limit int default 50) → setof` | أدمن aal2 فقط (`NOT_ALLOWED`). الأعمدة: `id, full_name, phone, status (مع expired محسوبة), created_at, decided_at, decided_by_name, decision_note`. `p_status`: `pending` (الأقدم أولاً) أو `decided` (آخر 30 يوماً، الأحدث أولاً) |
| D6 | `public.decide_driver_request(p_id uuid, p_approve boolean, p_note text default null) → text` | أدمن aal2 فقط. قفل الصف؛ الموافقة من `pending` فقط؛ **الرفض من `pending` أو من `approved`** (سحب الموافقة، سارية أو منتهية؛ R1 M1: يصير `rejected` ويُمسح رمز الإشعار ويُدقَّق `before.status = 'approved'`)؛ المكتمل والمرفوض ← `REQUEST_ALREADY_DECIDED` (`detail` = الحالة)؛ غير موجود ← `REQUEST_NOT_FOUND`؛ الرقم صار له حساب ← `PHONE_TAKEN` (يبقى `pending`). الموافقة: `approved`، `approved_until = now() + 7 days`، وإشعار للجهاز إن كان له رمز (D9). الرفض: `rejected` ومسح `push_token`. سطر `admin_audit` (`action = 'driver_request'`، `before = {status}`، `after = {status, note, phone}`). يرجع الحالة الجديدة. **إعادة فتح** طلب منتهٍ: لا؛ السائق يسجّل من جديد |
| D7 | `public.begin_driver_completion(p_request_id, p_secret_hash) → table(phone, full_name)` و`public.finish_driver_registration(p_request_id, p_user_id) → void` | service_role فقط. الأولى: قفل الصف، تطابق الـ hash (وإلا `REQUEST_NOT_FOUND`)، الحالة `approved` وغير منتهية (وإلا `REQUEST_NOT_APPROVED` / `REQUEST_EXPIRED`). الثانية بمعاملة (وتتحقق بنفسها أن الموافقة لم تنتهِ: `REQUEST_EXPIRED`، R1 L1): `profiles` ← `role = 'driver'`، `full_name`، `is_active = true`، `must_change_pin = false`؛ الطلب ← `completed`، `user_id`، `completed_at`، مسح `push_token`؛ شرطية على `status = 'approved'` (وإلا `REQUEST_NOT_APPROVED`) |
| D8 | قيد `admin_audit_action_check` | يضاف `'driver_request'` (drop + add بنفس نمط `20261206000001`) |
| D9 | إشعار جهاز بلا حساب | قيد `notification_outbox_audience_check` يضاف `'driver_request'`؛ عمود جديد `driver_request_id uuid null → driver_requests on delete cascade` وقيد `(audience = 'driver_request') = (driver_request_id is not null)`. `claim_push_notifications` (استبدال الدالة) يحلّ هذا الجمهور إلى `driver_requests.push_token` (مزوّد `expo`) **فقط إن كان الطلب ما زال `approved`**. العنوان "وافق المحل على طلبك"، `data = {type: 'driver_request_approved', request_id}`. لا تغيير بـ `push-dispatch` نفسها إن رجعت الدالة الرموز بنفس الشكل (يُتحقق بالتخطيط) |
| D10 | التنظيف | إضافة لمهمة `pg_cron` اليومية الموجودة: حذف `driver_requests` بحالة `rejected`/`completed` أو منتهية، أقدم من 30 يوماً من آخر تغيير؛ وتنظيف `private.driver_request_rate_limits` الأقدم من يوم |
| D11 | الصلاحيات و`01_schema.sql` | `grant execute` صريح لكل دالة جديدة؛ قائمة دوال service_role بـ `01_schema.sql` تُحدَّث (D2، D3، D7)؛ D4 تُضاف لقائمة الدوال المكشوفة لـ `anon` المقصودة (تحذير Advisor متوقع ومُوثَّق) |
| D12 | الأنواع | `pnpm` توليد `database.types.ts` من جديد |
| D13 | عمود `line_count` بـ `available_orders` | عدد البنود المختلفة بالطلب (لعبارة "N منتجات"، قرار المالك 2026-11-19). إضافة عمود للمخرجات تتطلب `drop function` + `create` بنفس الصلاحيات والسلوك؛ `item_count` يبقى. لا اسم ولا هاتف ولا طابق ولا شقة. اختبار `05_driver.sql` يُحدَّث |

| D14 | إصلاحات R1 (migration `20261209000001`) | `set_user_role`: زبون ← سائق يتطلب `must_change_pin` (`PIN_RESET_REQUIRED`، H1)؛ `decide_driver_request` يسحب الموافقة (M1)؛ `finish_driver_registration` يفحص الانتهاء (L1)؛ `submit_driver_request`: إشعار الأدمن عام (M4) والموافقة المنتهية تبقى `rejected` بملاحظة "انتهت مدة الموافقة وسُجّل طلب جديد" بدل الحذف (L5)؛ `pending_driver_requests_count()` للأدمن aal2 لشارة اللوحة (L8) |

**لا تغيير** بدوال السائق الحالية غير إضافة عمود D13 لـ `available_orders` (`accept_order`، `set_order_status`، `register_push_token`) ولا بسياسات `orders`. التطبيق يستخدمها كما بـ DRIVER-API.

### 4.2 Edge Function جديدة: `driver-register`
- `POST {full_name, phone, device_secret, push_token?}`، `verify_jwt = false`، بلا JWT (المفتاح المنشور فقط)، CORS بنفس `_shared/cors.ts` (لا متصفح متوقع).
- بالترتيب: `driver_request_rate_hit(cf-connecting-ip, null)` **أولاً**، حد الـ IP وحده (فشل ← `RATE_LIMITED` 429؛ فشل الدالة نفسها ← `REGISTER_FAILED` 500، تفشل مغلقة) ← جسم صالح (وإلا `INVALID_REQUEST` 400) ← `normalizeIraqiPhone` (`PHONE_INVALID` 400) ← الاسم 2..80 (`NAME_INVALID` 400) ← `device_secret` base64url يفكّ لـ 32 بايت بالضبط (`INVALID_REQUEST` 400) ← **حد الرقم** `driver_request_rate_hit(null, phone)` (3/24 ساعة؛ بعد الفحص فقط، R1 M3) ← `push_token` إن وُجد بصيغة Expo (وإلا يُتجاهل) ← SHA-256 للسر بالدالة ← `submit_driver_request`.
- الرد: `201 {request_id}`؛ `PHONE_TAKEN` 409، `REQUEST_EXISTS` 409، `TOO_MANY_PENDING` 429، `REGISTER_FAILED` 500.
- لا يُسجَّل الجسم ولا السر ولا الـ hash.

### 4.3 الحالة: RPC مباشر
`supabase.rpc('driver_request_status', { p_request_id, p_device_secret })` بالمفتاح المنشور (دور `anon`). لا Edge Function (أرخص وأبسط؛ السر 256 بت فلا تخمين).

### 4.4 Edge Function جديدة: `driver-complete-registration`
- `POST {request_id, device_secret, pin}`، `verify_jwt = false`.
- بالترتيب: جسم صالح ← حد IP (نفس `driver_request_rate_hit` بلا رقم، أو مفتاح IP فقط) ← SHA-256 للسر ← `begin_driver_completion` (`REQUEST_NOT_FOUND` 404، `REQUEST_NOT_APPROVED` 409، `REQUEST_EXPIRED` 410) ← `validatePin(normalizePin(pin), phone)` (`PIN_INVALID` 400 مع `detail`) ← `auth.admin.createUser({ phone, password: pin, phone_confirm: true })` (موجود ← `PHONE_TAKEN` 409، والطلب يبقى `approved` ليحله الأدمن) ← `finish_driver_registration`؛ فشلها ← `auth.admin.deleteUser` للحساب المُنشأ (كـ `admin-create-user`) ثم: إن كان سبب الفشل `REQUEST_EXPIRED` (انتهت الموافقة بين `begin` و`finish`، R1 L1) ← 410، `REQUEST_NOT_APPROVED` (سُحبت) ← 409، `REQUEST_NOT_FOUND` ← 404 (T31، رد واضح بدل 500؛ التطبيق يعرض شاشة "انتهت مدة الموافقة")، وأي سبب آخر ← `INTERNAL` 500.
- الرد `201 {created: true}`؛ التطبيق يدخل بـ `signInWithPassword`.
- لا يُسجَّل الرمز ولا السر (`errTextWithout` الموجود).

### 4.5 الأخطاء الجديدة (`packages/shared/src/errors.ts` + SPEC-backend §5)
`NAME_INVALID`، `REQUEST_EXISTS`، `TOO_MANY_PENDING`، `REGISTER_FAILED`، `REQUEST_NOT_FOUND`، `REQUEST_NOT_APPROVED`، `REQUEST_EXPIRED`، `REQUEST_ALREADY_DECIDED`. اختبار Jest الحالي يفشل إن نقص رمز.

---

## 5) لوحة الأدمن: "طلبات السواق" (`/driver-requests`، أدمن فقط)

> **مبنية بـ T29 (2026-11-20):** المواصفة المعتمدة الآن في [SPEC-admin §2.10](SPEC-admin.md)؛ هذا القسم يبقى سياق القرار.

- بـ `apps/admin/src/lib/access.ts`: أدمن فقط، تحت "الإعدادات والموظفون" بجانب `/staff`، مع **شارة** بعدد الطلبات المعلّقة. الموظف ← 403 حتى بالرابط المباشر.
- تبويبان: **"بانتظار الموافقة"** (`list_driver_requests('pending')`) و**"آخر القرارات"** (`'decided'`، 30 يوماً).
- الصف: الاسم، الرقم (زر اتصال `tel:` ونسخ)، منذ متى، و(بالقرارات) الحالة ومن قرر ومتى والملاحظة.
- **"موافقة"** ← نافذة: "اتصلت بالرقم 07… وتأكدت أنه نفس الشخص؟" (خانة إلزامية "اتصلت وتأكدت") ← `decide_driver_request(id, true)`. **"رفض"** ← نافذة بملاحظة اختيارية (≤ 300) ← `decide_driver_request(id, false, note)`. **"سحب الموافقة"** (R1 M1، بتبويب "آخر القرارات" لصف موافَق عليه أو منتهٍ) ← نفس نافذة الرفض ← `decide_driver_request(id, false, note)`؛ الجهاز يراه `rejected`. الشارة من `pending_driver_requests_count()` (R1 L8).
- الأخطاء: `REQUEST_ALREADY_DECIDED` ← تحديث القائمة؛ `PHONE_TAKEN` ← "الرقم صار له حساب. رقّيه كسائق من صفحة الموظفين".
- إشعار جهاز للأدمن عند طلب جديد (`admins_only`، D3)؛ فتحه ← هذه الصفحة.
- بعد اكتمال التسجيل يظهر السائق تلقائياً بـ `/staff` (دور `driver`)، والتعطيل والإدارة بالمسار الموجود.

**RUNBOOK (قسم جديد "طلبات السواق"):** الأدمن **يتصل بالرقم قبل الموافقة** ويتأكد من الاسم وأنه فعلاً قدّم الطلب؛ لا موافقة من رسالة فقط. الموافقة صالحة 7 أيام. سائق غيّر جهازه قبل اختيار الرمز ← رفض الطلب القديم وتسجيل جديد. نسيان الرمز لاحقاً ← `admin-reset-pin` (§7 الموجود، مكالمة للسائق). نشر الدالتين الجديدتين على dev بموافقة صاحب المشروع.

---

## 6) التقنية والأوامر

### Tech stack
- Expo SDK ونفس إصدارات `apps/customer` (Expo Router، TypeScript، `@supabase/supabase-js` v2، TanStack Query، `expo-secure-store`، `expo-notifications`، `expo-crypto`، `expo-linking`). **لا اعتماديات جديدة** غير `expo-crypto` (إن لم تكن موجودة) — أي اعتمادية أخرى تُسأل قبلها.
- `packages/shared`: `phonePinCredentials`، `validatePin`/`normalizePin`، `normalizeIraqiPhone`، `formatAddress`، `formatQuantity`، `formatIqd`، `errors.ts`، والجديدة `baghdadDayRange`.
- المعرّف: `com.mukhdar.driver`، الاسم "سوق بسماوي - السائق"، مشروع EAS منفصل (`push-dispatch` يدعم أكثر من مشروع Expo أصلاً)، تطبيق Firebase ثانٍ لـ FCM (ملف `google-services.json` كمتغير ملف بـ EAS، لا يُرفع لـ git).
- حماية `app.config.ts` نفسها: بناء `production` لا يشير لمشروع dev.

### الأوامر
```
pnpm install
pnpm --filter @mukhdar/driver start            # Expo dev (development build؛ الإشعارات لا تعمل بـ Expo Go)
pnpm --filter @mukhdar/driver test             # Jest + RNTL
pnpm --filter @mukhdar/driver typecheck
pnpm lint && pnpm typecheck && pnpm test       # كل الـ repo (CI)
pnpm test:functions                            # deno check + deno test (تُضاف الدالتان للقائمة)
pnpm db:test                                   # pgTAP محلياً (CI)
pnpm db:test:remote                            # pgTAP على mukhdar-dev
pnpm sb db push --dry-run && pnpm sb db push   # dev فقط، ثم: pnpm sb migration list --remote
pnpm it:driver-register                        # تكامل جديد على dev (§7)
pnpm --filter @mukhdar/admin test:e2e          # Playwright للوحة
eas build -p android --profile preview         # APK داخلي (بموافقة المالك)
pnpm --filter @mukhdar/driver run export:web   # PWA (T37): dist + CSP بهاش + فحص الأسرار
pnpm --filter @mukhdar/driver test:e2e         # Playwright WebKit + Chromium على dist (login.spec.ts على dev)
```

### الويب (PWA، T37، SPEC-webpush §3)
- **الأصل:** `https://mukhdar-driver.pages.dev` (مشروع Cloudflare Pages `mukhdar-driver`، أمر البناء `pnpm --filter @mukhdar/driver run export:web`، الإخراج `apps/driver/dist`؛ RUNBOOK §16f). نفس الكود ونفس المنطق للـ APK والويب.
- **فصل المنصات بملفات `*.web.ts(x)`** بنفس أسماء التصدير (`web-platform.test.ts` يفرض ذلك ويمنع استيراد `expo-notifications`/`expo-device`/`expo-updates`/`expo-secure-store` بنسخ الويب): `secureStorage`/`secureStore` (T34، IndexedDB مشفّر)، `rtl.web.ts` (`<html dir="rtl" lang="ar">` بلا إعادة تحميل)، `push.web.ts` بديل يرجع `unsupported` حتى T38، `NotificationsBridge.web.tsx` بلا عمل. `BackHandler` بـ react-native-web لا-عملية.
- **بوابة التثبيت** (`features/install/`): `installState()` دالة نقية ← `standalone | ios-browser | android-installable | other-browser | unsupported-ios`. على iOS خارج التطبيق المثبَّت (وتحت 16.4 حتى لو مثبَّت) شاشة كاملة تحجب الدخول والتسجيل (تخزين الـ PWA المثبَّت منفصل عن Safari، والإشعارات للمثبَّت فقط). Android: شريط "ثبّت التطبيق" اختياري من `beforeinstallprompt`. الأصلي = `standalone` دائماً. iPadOS بوكيل سطح المكتب يُكشف بشاشة اللمس.
- **الرؤوس:** `public/_headers` بـ CSP **بلا `unsafe-inline` للسكربت** (`scripts/web-postexport.mjs` يحسب هاش أي `<script>` داخلي ويرفض `unsafe-inline`/`unsafe-eval`؛ اليوم لا يوجد ← `'self'` وحدها)، `worker-src 'self'`، `object-src 'none'`، `frame-ancestors 'none'`، و`no-cache` لـ `/` و`index.html` و`sw.js`. نفس التشديد لتطبيق الزبون.
- **CI:** `export:web` + فحص الأسرار (`scripts/check-web-bundle.mjs`: مفتاح `sb_secret_`، JWT بدور `service_role`، مفتاح PEM خاص، `VAPID_PRIVATE_KEY`) + Playwright بلا خادم (manifest، الرؤوس، RTL، البوابة، لا أخطاء CSP).
- **افتراض (T37):** الأيقونات نفس أيقونات الزبون مؤقتاً (افتراض A3)، ورقم/واتساب المحل فارغان على Pages (الزران مخفيان) حتى يقرّر المالك.

### هيكل المشروع
```
apps/driver/
  app.config.ts  eas.json  package.json  .env.example
  src/app/            الشاشات (§2)
  src/features/       auth/ (register, pendingPoll, setPin, deviceSecret)، orders/ (available, mine, detail, transitions)، today/، account/
  src/components/     OrderCard، AddressBlocks، StatusButton، ConfirmSheet، PinInput، PhoneInput
  src/lib/            supabase.ts، push.ts، secureStore.ts
  src/__tests__/
supabase/migrations/2026120800000N_driver_requests.sql
supabase/functions/driver-register/{index,handler,driver_register_test}.ts
supabase/functions/driver-complete-registration/{index,handler,..._test}.ts
supabase/tests/36_driver_requests.sql
apps/admin/src/app/(panel)/driver-requests/  + e2e/driver-requests.spec.ts
scripts/driver-register-it.mjs
```

### أسلوب الكود
نفس أسلوب `apps/customer`: منطق الشاشة بـ `features/*` كدوال صرفة قابلة للاختبار، والشاشة تعرض فقط؛ كل نص للمستخدم عربي بملف `i18n`؛ أخطاء الخادم تُترجم عبر `errors.ts` لا نصوص داخل الشاشة. مثال:

```ts
// src/features/orders/transitions.ts
export type DriverAction = { label: string; to: 'out_for_delivery' | 'delivered'; confirm: boolean } | null;

export function nextAction(status: OrderStatus): DriverAction {
  switch (status) {
    case 'ready': return { label: t('order.pickedUp'), to: 'out_for_delivery', confirm: false };
    case 'out_for_delivery': return { label: t('order.delivered'), to: 'delivered', confirm: true };
    default: return null; // preparing: زر معطّل "بانتظار التحضير"
  }
}
```

---

## 7) الاختبارات

| المستوى | ماذا | أين |
|---|---|---|
| pgTAP **بالدور الحقيقي** | D4 كـ `anon` (سر صحيح/خاطئ/طول خاطئ ← `not_found`، كل الحالات ومنها `expired`)؛ D5/D6 كأدمن aal2 (موافقة، رفض، قرار مكرر، `PHONE_TAKEN`، سطر `admin_audit`) ومرفوضة لأدمن aal1 وموظف وسائق وزبون و`anon`؛ D2/D3/D7 مرفوضة لكل دور غير service_role؛ D3 (طلب مفتوح واحد، إعادة الإرسال بنفس الـ hash، `TOO_MANY_PENDING`، إشعار الأدمن)؛ D7 (الملف الشخصي سائق فعّال بلا `must_change_pin`، الانتقال الشرطي، المنتهي)؛ D9 (`claim_push_notifications` يرجع رمز الطلب الموافَق فقط)؛ D10 التنظيف؛ ثم كسائق جديد حقيقي: `available_orders` و`accept_order` تعمل. `anon`/`authenticated` لا يقرأان `driver_requests` مباشرة | `supabase/tests/36_driver_requests.sql`، و`32_real_role_writes.sql` و`01_schema.sql` تُحدَّث |
| Deno | الدالتان بـ fetch مزيف: كل رمز خطأ، الحد، السر لا يُسجَّل، حذف الحساب عند فشل `finish`، الترتيب (الحد قبل أي عمل) | `supabase/functions/driver-*/..._test.ts` |
| Jest/RNTL (التطبيق) | حارس الحالة لكل حالة؛ توليد السر وحفظه قبل الإرسال؛ استطلاع Pending وتوقفه بالخلفية؛ set-pin (تطابق، `validatePin`)؛ البطاقة الجاهزة بلا اسم/هاتف؛ "قبله سائق ثاني"؛ الزر لكل حالة والتأكيد المزدوج؛ العنوان بـ `G` وبلا طابق ولزبون محذوف؛ مجموع اليوم | `apps/driver/src/__tests__` |
| وحدة (shared) | `baghdadDayRange` (حدود منتصف الليل UTC+3) | `packages/shared/src/__tests__` |
| Playwright (اللوحة) | الأدمن يوافق ويرفض (خانة المكالمة إلزامية)؛ الموظف 403؛ الشارة | `apps/admin/e2e/driver-requests.spec.ts` |
| تكامل على dev | `pnpm it:driver-register`: تسجيل ← حالة `pending` ← موافقة كأدمن aal2 ← جهاز بسر خاطئ يفشل ← اختيار الرمز ← دخول ← `available_orders` ← تنظيف الحساب | `scripts/driver-register-it.mjs` |
| CI | التزامن الموجود (8 سائقين يقبلون طلباً واحداً، واحد ينجح) يبقى؛ يُضاف تطبيق السائق لـ lint/typecheck/test | `.github/workflows` |
| يدوي (APK على جهازين Android) | الدورة الكاملة (§9) | تقرير بـ `docs/reviews/` |

---

## 8) الحدود

- **دائماً:** فرع feature لكل مهمة ← push ← PR ← دمج بعد CI أخضر فقط (CLAUDE.md 11). مهمة واحدة بالمرة. migration جديدة لكل تغيير DB، `pnpm sb db push` على **dev فقط**. اختبار كل كتابة بدور حقيقي. `validatePin` بالتطبيق والخادم. المبالغ أعداد صحيحة. العنوان بـ `formatAddress` فقط.
- **اسأل أولاً:** نشر الدالتين على dev وإعداد أسرارهما؛ أي EAS Build أو إنشاء مشروع EAS/Firebase؛ أي اعتمادية جديدة غير `expo-crypto`؛ أي تغيير بدوال السائق الحالية أو بـ `available_orders`؛ أي شيء على الإنتاج.
- **ممنوع:** `service_role` بالتطبيق؛ تخزين السر أو الرمز بلا تشفير أو بالسجلات؛ تعطيل RLS؛ SMS/OTP؛ حساب Auth قبل الموافقة؛ تعديل migration قديمة؛ `apply_migration`/`execute_sql` عبر MCP.

---

## 9) معايير النجاح (النسخة الأولى منجزة عندما)

1. كل فحوص CI خضراء، ومنها `36_driver_requests.sql` واختبارات Deno والتطبيق.
2. `pnpm it:driver-register` ينجح على dev، و`pnpm sb migration list --remote` بلا اختلاف.
3. على APK بجهازين Android حقيقيين: سائق يسجّل ← الأدمن يتصل ويوافق من اللوحة ← الجهاز يتحول لاختيار الرمز (بإشعار أو خلال 30 ثانية) ← يختار رمزه ويدخل. جهاز ثانٍ بنفس الرقم لا يقدر يكمل. طلب مرفوض لا يدخل.
4. الدورة: زبون يطلب ← الأدمن يحضّر و"جاهز" ← **السائقان يستلمان إشعاراً** ← كلاهما يضغط قبول، واحد فقط ينجح والثاني يرى "قبله سائق ثاني" ← "بالطريق" ← "تم التوصيل" ← الزبون يقيّم ← سجل اليوم يعرض المبلغ الصحيح.
5. العنوان يعرض `الطابق G` للأرضي، والاتصال والواتساب يفتحان رقم الزبون.
6. نسيان الرمز: الأدمن يعيد الضبط ← السائق يدخل بالمؤقت ← تغيير إجباري ← يكمل.

---

## 10) خطة المهام المقترحة (تُفصَّل بعد الموافقة على هذا الـ SPEC)

| # | المهمة | تعتمد على |
|---|---|---|
| T27 | DB: طلبات السواق (D1–D13) + pgTAP + تحديث الوثائق (CLAUDE.md، 00-README، T21، DRIVER-API، SPEC-backend) | — |
| T28 | Edge Functions: `driver-register` و`driver-complete-registration` + Deno + `it:driver-register` | T27 |
| T29 | اللوحة: صفحة "طلبات السواق" + Playwright + RUNBOOK + SPEC-admin §2.10 | T27 |
| T30 | `apps/driver`: الهيكل، الحارس، الدخول، التسجيل، الانتظار، اختيار الرمز، تغيير الرمز الإجباري | T28 |
| T31 | التوصيل: الجاهزة، طلباتي (Realtime)، التفاصيل والأزرار | T30 |
| T32 | سجل اليوم، حسابي (تغيير الرمز، الاتصال، الخروج، الحذف)، الإشعارات | T31 |
| T33 | EAS APK + الفحص اليدوي على جهازين + تقرير؛ ثم مراجعة `/review` | T32 |

---

## قرارات المالك (2026-11-19، عند اعتماد الـ SPEC)

1. **الطابق والشقة** يُخفيان حتى القبول (البطاقة الجاهزة: البلوك والبناية فقط). `available_orders` لا يكشفهما.
2. **رقم مسجّل أصلاً كزبون:** `PHONE_TAKEN` كما هو، ومسار الترقية الموجود: الأدمن يعيد ضبط رمزه أولاً (`admin-reset-pin`، بعد مكالمة) ثم يجعله سائقاً (`set_user_role`). **(حُدِّث 2026-11-20، R1 H1: كان إجراءً بالـ RUNBOOK فقط؛ صار قاعدة بقاعدة البيانات:** `set_user_role` يرفض ترقية زبون لسائق بـ `PIN_RESET_REQUIRED` ما لم يكن `must_change_pin` مضبوطاً، مثل الموظف والأدمن. صاحب الرقم الحقيقي يستلم الرمز المؤقت بالمكالمة ويغيّره إجبارياً عند أول دخول.)
3. **صلاحية الموافقة 7 أيام.**
4. **"حذف الحساب"** بصفحة حسابي (زر ثانوي بتأكيد).
5. **"N منتجات"** بالبطاقة الجاهزة = عدد البنود المختلفة (`line_count`، D13).
6. **واتساب بجانب "اتصل بالمحل"** بشاشة الدخول.
7. **حدود المعدل** كما بـ §3: 10/ساعة لكل IP، 3/يوم لكل رقم، 50 طلباً معلّقاً كحد أعلى.
8. **المطوّر الخارجي أُلغي نهائياً.** T27 يحدّث `CLAUDE.md` و`docs/tasks/00-README.md` و`21-driver-app.md` و`DRIVER-API.md` (يصير عقداً داخلياً لـ `apps/driver`).

## افتراضات ثابتة
1. لا GPS ولا خريطة بالنسخة الأولى (ملاحظة التصميم).
2. كل السائقين النشطين يستلمون "طلب جديد" عند `ready`؛ لا مفتاح "متاح/غير متاح" (يحتاج `is_available` وفلتراً بـ `push-dispatch`).
3. لا حد لعدد الطلبات التي يحملها السائق.
4. السائق يحصّل `total_iqd` كاملاً نقداً؛ التسوية مع المحل خارج التطبيق.
5. السائق لا يلغي ولا يعدّل البنود.
6. لا مكتبة واجهة مشتركة (`packages/ui`) بالنسخة الأولى: مكوّنات السائق داخل `apps/driver` بنفس قيم الألوان والخط؛ الاستخراج لاحقاً إن تكرر الكود.
7. لا PWA للسائق (تطبيق أصلي فقط؛ الإشعارات والتخزين الآمن أساسيان).
8. الإشعار بالموافقة أفضل جهد؛ الاستطلاع كل 30 ثانية هو الضمان.
9. **تنفيذ T27 (2026-11-20، migration `20261208000001`):** الـ hash = SHA-256 لنص السر (base64url، 43 محرفاً) بـ `sha256()` المدمجة؛ موافقة منتهية تُستبدل (تُحذف) عند تسجيل جديد لنفس الرقم؛ `finish_driver_registration` يرفض حساباً برقم غير رقم الطلب؛ مستلم إشعار الطلب `platform = 'unknown'`. التفاصيل: SPEC-backend §5 "طلبات تسجيل السواق" والافتراض 63.
11. **إصلاحات R1 (2026-11-20، migration `20261209000001` ودالة `driver-register` وتطبيق السائق):** H1 و M1 و M3 و M4 كما بقرارات المالك أعلاه (D14، §2.1، §3، §4.2، §5). L1 (`finish` يفحص الانتهاء)، L5 (المنتهية تبقى مرفوضة بملاحظة)، L8 (دالة العدّ)، L7 (CI يبني حزمة Android للسائق: `export:android`). L2 (حد الـ IP عند الـ CGNAT) وL3 وL4: وثائق فقط (RUNBOOK §16b). L6: بنود T31 (`NOT_ALLOWED` من أي دالة سائق ← `refreshProfile` والحارس). حد الرقم يُحسب على كل طلب اجتاز الفحص حتى إعادة الإرسال بنفس السر (القرار الأبسط الذي يطابق "طلبات اجتازت الفحص فقط").
10. **تنفيذ T30 (2026-11-20):** أيقونات التطبيق مؤقتاً نفس أيقونات الزبون حتى تصل أيقونة السائق؛ `register_push_token` بعد اختيار الرمز والدخول يُنفَّذ مع الإشعارات بـ T32 (T30 يرسل رمز Expo مع طلب التسجيل فقط إن سُمح)؛ سر الجهاز يُخزَّن بـ `WHEN_UNLOCKED_THIS_DEVICE_ONLY` ويُعاد استخدامه إن انقطعت محاولة قبل وصول `request_id` (نفس الطلب على الخادم)؛ حالة التطبيق `unknown` عند التشغيل تُعامل كواجهة (الاستطلاع يتوقف فقط بالخلفية)؛ خطأ الشبكة بالدخول يعرض رسالة الشبكة المشتركة (`NETWORK_ERROR_MESSAGE`) بدل "صار خلل" للتوحيد مع تطبيق الزبون؛ `PHONE_TAKEN` بالتسجيل يعرض "الرقم مسجّل عدنا. تواصل مع المحل حتى يفعّلك كسائق". الدوال المشتركة المنقولة من تطبيق الزبون لـ `packages/shared`: `whatsappUrl`، `telUrl`، `forgotPinWhatsappUrl`، `displayPhone`، `createChunkedStorage`، `changePin`.

### Web Push بالويب (T38، SPEC-webpush §5)
- `public/sw.js` (بلا fetch/كاش): `push` يعرض إشعاراً دائماً (`lang: ar`، `dir: rtl`، `tag = type:order_id`)، `notificationclick` يتحقق (نسخة JS من `routeForNotification`، يفحصها `sw-parity.test.ts`) ثم يركّز نافذة ويرسل `postMessage` أو `openWindow`. المنطق المشترك `createWebPush` بـ `packages/shared/src/webPush.ts`.
- `lib/push.web.ts`: اشتراك `userVisibleOnly` من لمسة فقط ← `register_web_push`؛ تسجيل صامت عند كل تشغيل/رجوع (`NotificationsBridge.web`)؛ بطاقة `PushPrompt.web` على الجاهزة (default ← زر، "مو هسه" 7 أيام، denied ← شريط، needs-install ← دليل).
- الخروج (`signOut`): حذف صف الاشتراك ← `unsubscribe()` ← القنوات ← خروج local؛ بلا شبكة: حذف مؤجَّل مشفَّر يُعاد بأول جلسة. المفتاح العام `EXPO_PUBLIC_VAPID_PUBLIC_KEY` (بلا مفتاح = لا Web Push).
