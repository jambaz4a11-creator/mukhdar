# المهام (tasks)

قواعد العمل:
- مهمة واحدة بالجلسة. لا تبدأ مهمة قبل أن تنجح اختبارات السابقة لها.
- كل مهمة تنتهي بـ: الاختبارات تمر ← commit برسالة `task NN: ...` ← تحديث الحالة بهذا الجدول.
- أي قرار غير محدد: اكتبه بقسم "افتراضات" في ملف الـ SPEC المعني.
- التغيير في قاعدة البيانات = migration جديدة دائماً (لا تعدّل migration طُبّقت على السحابة).

| # | المهمة | تعتمد على | الحالة |
|---|---|---|---|
| 01 | [إعداد الـ monorepo](01-repo-setup.md) | - | ✅ |
| 02 | [مشروع Supabase للتطوير](02-supabase-dev-project.md) | 01 | ✅ |
| 03 | [اختبارات قاعدة البيانات pgTAP](03-db-tests.md) | 02 | ✅ |
| 04 | [التحقق عبر واتساب (لاحقاً، اختياري)](04-whatsapp-verification.md) | - | ⏸ اختياري، لا يمنع شيئاً |
| 05 | [بيانات تجريبية seed](05-seed-demo.md) | 02 | ✅ |
| 06 | [الحزمة المشتركة](06-shared-package.md) | 02 | ✅ |
| 07 | [Edge Function: push-dispatch](07-edge-push-dispatch.md) | 03 | ✅ (فحص الجهاز الحقيقي ← T14، بانتظار development build) |
| 08 | [Edge Function: delete-account](08-edge-delete-account.md) | 03 | ✅ (صفحة الويب ← T16) |
| 09 | [هيكل تطبيق الزبون](09-customer-scaffold.md) | 06 | ✅ (فحص Expo Go وSentry يدوي) |
| 10 | [دخول الزبون](10-customer-auth.md) | 09 | ✅ (فحص الأجهزة يدوي) |
| 11 | [الكتالوج](11-customer-catalog.md) | 05، 09 | ✅ (فحص التمرير وبدون شبكة يدوي) |
| 12 | [العناوين](12-customer-addresses.md) | 10 | ✅ (فحص الجهاز يدوي) |
| 13 | [السلة وتأكيد الطلب](13-customer-cart-checkout.md) | 11، 12 | ✅ (فحص قطع الشبكة على جهاز يدوي) |
| 14 | [تتبع الطلبات والتقييم والإشعارات](14-customer-orders.md) | 07، 13 | ✅ (إشعار الجهاز الحقيقي ← development build؛ Realtime Inspector يدوي) |
| 15 | [حسابي وحذف الحساب](15-customer-account.md) | 08، 10 | ✅ (صفحات الخصوصية/الشروط ← T16؛ الحذف على جهاز يدوي) |
| 16 | [هيكل لوحة الأدمن والدخول](16-admin-scaffold.md) | 06 | ✅ (النشر على Vercel مؤجل بموافقة صاحب المشروع) |
| 17 | [صفحة الطلبات](17-admin-orders.md) | 16 | ✅ |
| 18 | [المنتجات والمخزون](18-admin-catalog-stock.md) | 16 | ✅ |
| 19 | [العناوين والموظفون والإعدادات](19-admin-addresses-staff-settings.md) | 16 | ✅ |
| 20 | [التقارير](20-admin-reports.md) | 17، 18 | ✅ |
| 25 | [الرئيسية (مؤشرات اليوم)](25-admin-dashboard.md) | 17، 18، 20 + تصميم "الرئيسية" | ✅ |
| 26 | [التقييمات](26-admin-ratings.md) | 16 + تصميم "التقييمات" | ✅ |
| 21 | [تطبيق السائق](21-driver-app.md) | - | أُلغيت ← T27–T33 |
| 22 | [اختبار الحمل k6](22-load-test.md) | 13 | ✅ (قرار المالك 2026-11-17: الصحة اجتازت بتشغيلين كاملين؛ عتبات الزمن لم تتحقق على dev المجاني بسنغافورة بسبب الشبكة وتقطعات الخطة المجانية لا قاعدة البيانات؛ **زمن الاستجابة يُعاد قياسه على مشروع الإنتاج قبل الإطلاق** (RUNBOOK §17 البند 4). انظر [التقرير](../reviews/load-test-T22.md)) |
| 23 | [مراجعة الأمان](23-security-review.md) | 22 | ✅ 2026-11-17 ([التقرير](../reviews/security-T23.md): بنوده الـ 15 منجزة بجلستي E1 وE2، ومراجعتهما ([review-E1-E2](../reviews/review-E1-E2.md)) منجزة بجلسة F، [ADR 0003](../ADR/0003-security-review.md)؛ مطبّقة على mukhdar-dev. الباقي إعدادات الإنتاج اليدوية: RUNBOOK §17.5) |
| 24 | [الإطلاق](24-release.md) | 23 | ⬜ |

### تطبيق السائق داخل الـ repo (SPEC-driver، قرار المالك 2026-11-19)

| # | المهمة | تعتمد على | النموذج | على dev | الحالة |
|---|---|---|---|---|---|
| 27 | [قاعدة بيانات طلبات السواق + تحديث الوثائق](27-driver-requests-db.md) | - | Opus | migration | ✅ 2026-11-20 (migration `20261208000001` على mukhdar-dev) |
| 28 | [Edge Functions تسجيل السائق](28-driver-register-functions.md) | 27 | Opus | نشر دالتين | ✅ |
| 29 | [اللوحة: طلبات السواق](29-admin-driver-requests.md) | 27 | Sonnet | - | ✅ 2026-11-20 (PR #15، CI أخضر، نُشرت اللوحة على Cloudflare) |
| 30 | [`apps/driver`: الهيكل والحارس والدخول والتسجيل](30-driver-app-auth.md) | 28 | Opus | - | ✅ 2026-11-20 (PR #17، CI أخضر؛ `it:driver-register` على dev 28/28؛ فحص الشاشات على Expo Go يدوي، RUNBOOK §16d) |
| R1 | **مراجعة** (`/review`) لـ T27–T30: الأمان (سر الجهاز، صلاحيات `anon`)، الاختبارات بالدور الحقيقي، الحارس. البنود تُصلَح قبل T31 | 27–30 | Opus | - | ✅ 2026-11-20 ([التقرير](../reviews/review-R1-driver.md): 0 Critical، 1 High، 4 Medium، 8 Low). **الإصلاحات منجزة (PR #19، 2026-11-20):** H1 وM1–M4 وبنود Low (migration `20261209000001` على mukhdar-dev، L6 بقائمة T31) |
| 31 | [الطلبات الجاهزة وطلباتي والتفاصيل](31-driver-app-delivery.md) | 30، R1 | Sonnet | إعادة نشر `driver-complete-registration` فقط | ✅ 2026-11-20 (فحص الشاشات على جهاز يدوي ← T33) |
| 32 | [سجل اليوم وحسابي والإشعارات](32-driver-app-today-account-push.md) | 31 | Sonnet | EAS + Firebase (development build) | 🟡 الكود منجز 2026-11-21 (مشروع EAS وFirebase وdevelopment build جاهزة؛ فحص الإشعارات على جهاز ← T33) |
| R2 | **مراجعة نهائية** (`/review`) لـ T27–T32 قبل بناء الـ APK: كل مسار SPEC-driver §9 مغطى، لا سر أو رمز بالسجلات، `migration list` مطابق | 27–32 | Opus | - | ✅ 2026-11-21 ([التقرير](../reviews/review-R2-driver.md): 1 Critical (C1: اشتراك Realtime مشترك يُسقط شاشة الطلب)، 0 High، 2 Medium (M1 بيئة EAS `preview`، M2 رمز الإشعار عند الخروج من شاشات أخرى)، 6 Low؛ `migration list` مطابق 39 = 39). **الإصلاحات قبل T33: منجزة 2026-11-21** (C1 وM1 وM2 وL1–L4 وL6؛ L5 بقائمة T33؛ متغيرات EAS `preview` أُنشئت بموافقة المالك، URL ومفتاح dev فقط) |
| 33 | [APK السائق والفحص على أجهزة حقيقية](33-driver-app-apk.md) | 32، R2 | Sonnet | EAS APK build | 🟡 الـ APK مبني 2026-11-23 (profile `preview`، من `main` عند `4b118e0`، يشير لـ mukhdar-dev؛ الرابط: https://expo.dev/accounts/jafar_sadiq20/projects/mukhdar-driver/builds/0a4f6b23-3931-4ba1-9e79-88760130db11)؛ **باقٍ:** الفحص اليدوي على جهازين وتقرير `driver-apk-T33.md`؛ ملاحظة: `EXPO_PUBLIC_SHOP_PHONE` و`EXPO_PUBLIC_SHOP_WHATSAPP` غير مضبوطين بمتغيرات EAS `preview` فأزرار الاتصال والواتساب مخفية بهذا الـ APK |

### PWA السائق + Web Push ([SPEC-webpush](../SPEC-webpush.md)، معتمدة 2026-11-21)

للسائقين على iPhone بلا حساب Apple Developer، وإشعارات الويب للزبون والسائق. أصل السائق النهائي `https://mukhdar-driver.pages.dev`. لا تعتمد على T33 (تُنفَّذ بعدها أو بالتوازي). "على dev" = بموافقتك.

| # | المهمة | تعتمد على | النموذج | على dev | الحالة |
|---|---|---|---|---|---|
| 34 | [التخزين المشفَّر للويب (W1)](34-web-secure-storage.md) | - | Opus | - | ✅ 2026-11-21 (PR #26، CI أخضر؛ Playwright الزبون Chromium وWebKit) |
| 35 | [مرسِل Web Push بـ push-dispatch (W2)](35-webpush-sender.md) | - | Opus | - (كود محلي؛ النشر بـ 38) | ✅ 2026-11-21 (PR #27؛ قرار الاستكشاف: WebCrypto داخلي، متجه RFC 8291 مطابق بايتاً ببايت؛ Edge Runtime الفعلي يُفحص بأول نشر T38) |
| 36 | [قاعدة بيانات Web Push (W3)](36-webpush-db.md) | 35 | Opus | **migrations (2)** | ✅ 2026-11-21 (PR #28، CI أخضر؛ `20261210000001` و`20261210000002` على mukhdar-dev بـ `db push --remote` بعد dry-run، `migration list` مطابق 41 = 41، `db:test:remote` 37/37) |
| 37 | [تطبيق السائق PWA (W4)](37-driver-pwa.md) | 34 | Sonnet | **Cloudflare Pages `mukhdar-driver`** + `ALLOWED_ORIGINS` + إعادة نشر 3 دوال | ✅ 2026-11-21 (PR #29، CI أخضر؛ `ALLOWED_ORIGINS` على mukhdar-dev += `mukhdar-driver.pages.dev` (5 أصول، الهاش مطابق) وإعادة نشر الدوال الثلاث، CORS مفحوص؛ بناء Pages بعد الدمج) |
| 38 | [Web Push بالعميل: السائق والزبون (W5)](38-webpush-client.md) | 35، 36، 37 | Sonnet | **أسرار VAPID** + نشر `push-dispatch` + متغير VAPID العام بمشروعي Pages | ✅ 2026-11-22 (الكود والأسرار والنشر 2026-11-21؛ فحص Chrome سطح المكتب نجح بعد تفعيل إشعارات ويندوز؛ Android وiPhone ← T39) |
| W6 | اشتراك قبل الحساب لإشعار الموافقة | 36، 38 | Opus | migration + إعادة نشر `driver-register` | ⏸ مؤجَّلة (قرار المالك Q3: الـ polling كافٍ) |
| 39 | [فحص PWA والإشعارات على أجهزة حقيقية (W7)](39-pwa-device-check.md) | 38 | Sonnet | - (آيفون 11 iOS 16.4+ متوفر) | ✅ 2026-11-23 (فحص المالك على آيفون 11 iOS 26.6 بالـ PWA الحقيقية المضافة للشاشة الرئيسية: الزبون والسائق كلاهما نجح؛ [التقرير](../reviews/pwa-webpush-W7.md)؛ فحص Android Chrome لم يُنفَّذ) |
| R3 | [**مراجعة** PWA وWeb Push](R3-pwa-webpush-review.md) | 34–39 | Opus | - | ✅ 2026-11-22 لـ T34–T38 ([التقرير](../reviews/review-R3-pwa-webpush.md): 0 Critical، 0 High، 4 Medium، 9 Low؛ `migration list` مطابق 41 = 41). **الإصلاحات منجزة (PR #34، 2026-11-22):** كل البنود M1–M4 وL1–L9؛ migration `20261211000001` على mukhdar-dev بـ `db push` بعد dry-run، `migration list` مطابق 42 = 42؛ لا إعادة نشر دوال |

### تسليم الكاش ([SPEC-cash](../SPEC-cash.md)، قرارات المالك 2026-11-22)

السائق يسلّم كل الكاش منذ آخر تسليم دفعة واحدة؛ من يفتح اللوحة (أدمن أو موظف) يسجّل المبلغ المستلم فعلاً، والفرق نقص أو زيادة بملاحظة. **SPEC-cash معتمدة 2026-11-22:** Q1 صارت إعداداً للأدمن ("أجرة التوصيل للمحل" افتراضياً، أو "تبقى عند السائق")، وكل تسليم يحفظ مبلغه وقيمة الإعداد لحظتها.

| # | المهمة | تعتمد على | النموذج | على dev | الحالة |
|---|---|---|---|---|---|
| 40 | [DB: `cash_handovers` والدوال والرصيد الافتتاحي وإعداد الأجرة + pgTAP بالدور الحقيقي + التزامن](40-cash-handover-db.md) | Q1 ✅ | Opus | **migration** | ✅ 2026-11-22 (PR #37، CI أخضر؛ `20261212000001` على mukhdar-dev بـ `db push --remote` بعد dry-run، 43 = 43، `db:test:remote` 39/39؛ إعادة نشر `delete-account` مع T42) |
| 41 | [اللوحة: "تسليم الكاش" + قسم التقارير + إعداد الأجرة بـ `/settings` + Playwright](41-admin-cash.md) | 40 | Sonnet | - | ✅ 2026-11-22 (PR بالفرع `feat/t41-admin-cash`؛ بلا migration ولا Edge Function؛ نشر اللوحة بعد الدمج) |
| 42 | [تطبيق السائق: الكاش منذ آخر تسليم، سجل التسليمات، الإشعار](42-driver-cash.md) | 40 | Sonnet | إعادة نشر `delete-account` فقط | ✅ 2026-11-22 (PR #39 مدموج، CI أخضر؛ بلا migration؛ `delete-account` أُعيد نشرها على mukhdar-dev فقط؛ بناء Cloudflare `mukhdar-driver` على main `770119a` ناجح) |
| 43 | [دعم المواد الغذائية والمنظفات: وحدتا `كيس` و`عبوة`، رسالة الحد حسب الوحدة، نصوص عامة](43-groceries-cleaning.md) | - | Sonnet | **migration** | ✅ 2026-11-23 (`20261215000001` على mukhdar-dev بـ `db push --remote` بعد dry-run، `db:test:remote` 41/41؛ لا شيء على الإنتاج) |
| R4 | [**مراجعة** (`/review`) لـ T40–T42: السباقات، تصنيف المبالغ، الأدوار، الثابت المحاسبي](R4-cash-review.md) | 40–42 | Opus | - | ✅ 2026-11-23 (الفحص اليدوي على dev بالـ PWA السائق منجز، انظر أدناه؛ التقرير [`docs/reviews/R4-cash-review.md`](../reviews/R4-cash-review.md) 2026-11-22: 0 Critical، 0 High، 2 Medium، 10 Low). **الإصلاحات منجزة (PR #44، 2026-11-22):** M1 (القاعدة باقية: الأجرة للمحل افتراضياً؛ "أجرة التوصيل عند السواق" بالتقرير + تأكيد بالمبلغ عند تغيير الإعداد)، M2، L1–L9، والاختبارات الثمانية T1–T8؛ L10 منجز 2026-11-23 (PR #46: migration `20261214000001` = `search_path = ''` على الدوال الثلاث بـ `alter function` فقط، اختبار `41_search_path_l10.sql` بـ 29 فحصاً بالأدوار الحقيقية؛ طُبّقت على mukhdar-dev بعد dry-run، `migration list` مطابق 45 = 45، `db:test:remote` 41/41 و1814 فحصاً). migration `20261213000001` على mukhdar-dev بـ `db push --remote` بعد dry-run، `migration list` مطابق 44 = 44، `db:test:remote` 40/40. **الفحص اليدوي على dev (SPEC-cash §14 البندان 3 و4): منجز 2026-11-23 على PWA السائق** (آيفون 11 iOS 26.6): تسجيل الدخول والإشعار بالطلبات الجديدة وسير الطلب وتسليم الكاش، كلها نجحت. فحص APK الأصلي يبقى ضمن T33) |

"على dev" = ما يحتاج **موافقة صاحب المشروع** قبل التنفيذ (migration بـ `pnpm sb db push`، نشر Edge Function، أو EAS/Firebase). الإنتاج خارج هذه الخطة. 29 مستقلة عن 28 (تُنفَّذ قبلها أو بعدها). iOS Ad Hoc لاحقاً، خارج T33.

المهمتان 25 و26 أُضيفتا بقرار المالك 2026-11-15 (لوحة مماثلة بوظائفها لمشروع سابق): رقمهما بعد 24 حتى لا يتغير ترقيم 21–24، لكن مكانهما بالتنفيذ بعد 20 وقبل 22. شاشات الرئيسية والتقييمات وهدر اليوم تُضاف للتصميم المعتمد قبلهما (وقبل شاشة هدر اليوم بـ T18).

المهمة 21 **أُلغيت** (قرار المالك 2026-11-19): تطبيق السائق `apps/driver` يُبنى داخل هذا الـ repo بالمهام T27–T33 ([SPEC-driver](../SPEC-driver.md)). عقد دوال السائق: [DRIVER-API.md](../DRIVER-API.md) (مرجع داخلي). المهمة 22 تحاكي السائق عبر نفس الدوال.

المهمة 04 **لم تعد مبكرة ولا مانعة** (قرار المالك 2026-11-14): لا SMS ولا OTP؛ الدخول برقم الهاتف + PIN من 6 أرقام بلا رسائل ([ADR 0001](../ADR/0001-phone-pin-auth.md)). T04 صارت "التحقق عبر واتساب"، لاحقاً واختيارية.


### تنبيهات لوحة الأدمن ([SPEC-admin-push](../SPEC-admin-push.md)، 2026-11-24)

| # | المهمة | تعتمد على | النموذج | على dev | الحالة |
|---|---|---|---|---|---|
| 44 | [تنبيهات اللوحة: Web Push للأدمن والموظف، صوت وعدّاد بالعنوان، PWA قابلة للتثبيت](44-admin-push.md) | 35–38 | Opus | **migration** + نشر `push-config` و`push-dispatch` | ⬜ |

### صحة ما قبل الإطلاق (2026-11-23)

- [`docs/reviews/pre-launch-health.md`](../reviews/pre-launch-health.md): audit، أحجام الحزم، Lighthouse، العربية/RTL، مرتَّبة بالخطورة مع قائمة المتابعة (أبرزها: خط MaterialCommunityIcons بحجم 1.28 MB لأيقونة واحدة بتطبيق السائق (أُصلح: صارت Ionicons)، وثقل التحميل الأول للزبون). أُصلح منها: `robots.txt` للتطبيقين وalt الصور الزخرفية.
- حادثة CORS (2026-11-23، [PR #51](https://github.com/jambaz4a11-creator/mukhdar/pull/51)): `ALLOWED_ORIGINS` كانت مكتوبة بـ `supabase/config.toml` فصار أمر `secrets set` يستبدل قيمة dev ويُسقط أصول الـ CORS الفعلية. الإصلاح: إخراجها من `config.toml` وإبقاؤها سراً يُضبط على السحابة فقط.
- الفحص الدخاني الحي (2026-11-23، [PR #52](https://github.com/jambaz4a11-creator/mukhdar/pull/52)): يعمل بعد كل نشر على Cloudflare وكل 6 ساعات، ويرسل إشعار ntfy عند الفشل.
- فحص الجهاز الحقيقي T39 (2026-11-23): آيفون 11 iOS 26.6 بالـ PWAs الحية المضافة للشاشة الرئيسية، الزبون والسائق نجحا ([التقرير](../reviews/pwa-webpush-W7.md)). وبه اكتمل فحص R4 اليدوي على PWA السائق.
- اختبار `addresses.test.tsx` المتقطع أُصلح (PR #45): سباق قراءة القيم المعبّأة بشاشة التعديل ومهلة Jest الافتراضية 5 ثوانٍ على CI البطيء؛ `testTimeout: 20000` بـ `apps/customer`.
