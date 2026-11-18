# RUNBOOK: تشغيل وصيانة "المخضر"

> هذا الملف يُكمَّل مع المهام. قسم الطوارئ (توقف الإشعارات، امتلاء القاعدة، الاستعادة) يأتي بـ T24.

## 1) المشاريع والمناطق

| البيئة | اسم المشروع | ref | المنطقة | الخطة |
|---|---|---|---|---|
| تطوير | `mukhdar-dev` | `ghcohlrzvehtcettaaiu` | `ap-southeast-1` (سنغافورة) | مجانية |
| إنتاج | `mukhdar-prod` (الاسم الإلزامي عند الإنشاء؛ لم يُنشأ بعد) | - (مكانه المحجوز `PROD_PROJECT_REFS` بـ `scripts/lib/projects.mjs`) | **يجب** `eu-central-1` (فرانكفورت) | Pro |

- **مشروع التطوير بسنغافورة** لأنه أُنشئ هناك مسبقاً. هذا مقبول للتطوير فقط.
- **مشروع الإنتاج يجب أن يُنشأ بمنطقة أوروبية: فرانكفورت (`eu-central-1`)**، لأنها أقرب للعراق وزمن الاستجابة منها أقل بكثير من سنغافورة. المنطقة لا تتغير بعد إنشاء المشروع، فانتبه لها وقت الإنشاء.
- المشاريع المجانية تتوقف بعد فترة عدم نشاط. إذا توقف `mukhdar-dev`، شغّله من اللوحة (Restore).

## 2) الأدوات (بدون Docker)

نعمل على المشروع السحابي مباشرة، ولا نشغّل Supabase محلياً (توفيراً للموارد على ويندوز).
الـ CLI مثبت كـ devDependency، ونستدعيه **فقط** عبر الحارس: `pnpm sb <أمر supabase>` (مثلاً `pnpm sb db push --remote --dry-run`). لا تستعمل `pnpm exec supabase` ولا `npx supabase` للعمل السحابي.

> **حارس `pnpm sb` (مراجعة C، H1):** يقرأ المشروع المربوط (`supabase/.temp/linked-project.json`) ويصنّفه بقائمتين صريحتين (`DEV_PROJECT_REFS` و`PROD_PROJECT_REFS`، كلتاهما بـ `scripts/lib/projects.mjs` منذ T23 H3؛ أي ref بالقائمتين يوقف كل السكربتات)، ويطبع أولاً لافتة ملونة: `TARGET: DEV mukhdar-dev (…)` أو `TARGET: *** PRODUCTION *** mukhdar-prod (…)`. أي ref خارج القائمتين **مرفوض دائماً**؛ وref الإنتاج الحالي **placeholder** فيُرفض كل شيء عليه إلى أن يُسجَّل الـ ref الحقيقي. على الإنتاج: الأوامر القارئة فقط (`--dry-run`، `migration list`، `functions list`، `db advisors`، `gen types`…) تعمل مباشرة؛ أي أمر يغيّر شيئاً يحتاج `MUKHDAR_TARGET=prod` **وكتابة الـ ref يدوياً** بطرفية حقيقية، ويُحذف `--yes` فيبقى سؤال الـ CLI نفسه. وأي `--project-ref`/`--remote=<ref>` يخالف المشروع المربوط يُرفض.
>
> **تنبيه:** كلمة `· production` التي يطبعها الـ CLI (مثلاً `Target: project mukhdar-dev (…) · production`) تعني "الفرع الافتراضي" لأي مشروع، **وليست البيئة**. لا تعتمد عليها؛ اعتمد على لافتة `pnpm sb`.

### تسجيل الدخول للـ CLI (مرة واحدة لكل جهاز)
الدخول التفاعلي يحتاج terminal حقيقي، فشغّله من نافذة PowerShell عادية:
```powershell
cd D:\Projects\Mukhdar\mukhdar
pnpm sb login
```

### كلمة سر قاعدة البيانات
تُحفظ بملف `.env.local` بجذر المشروع (مُتجاهل بـ git، **لا يُرفع أبداً**):
```
SUPABASE_DB_PASSWORD=...
```
إنشاؤه من PowerShell (يتجنب مشكلة Notepad الذي يضيف `.txt`):
```powershell
Set-Content -Path '.env.local' -Value 'SUPABASE_DB_PASSWORD=...' -Encoding ascii
```
للأوامر التي تحتاج الاتصال بالقاعدة (من Git Bash):
```bash
export SUPABASE_DB_PASSWORD=$(sed -n 's/^SUPABASE_DB_PASSWORD=//p' .env.local | tr -d '\r\n')
```
إذا ظهر `password authentication failed`: أعد ضبط كلمة السر من
Dashboard ← Project Settings ← Database ← Reset database password، وحدّث `.env.local`، وانتظر دقيقة.

### الربط (مرة واحدة)
```bash
pnpm sb link --project-ref ghcohlrzvehtcettaaiu
```
نسخة العمل هذه **مربوطة بـ mukhdar-dev دائماً ولا يُربط الإنتاج فيها أبداً**. الإنتاج له نسخة عمل منفصلة (§17 الخطوة 1).

## 3) تطبيق الـ migrations

```bash
pnpm sb db push --remote --dry-run   # يعرض ما سيُطبَّق
pnpm sb db push --remote --yes       # يطبّق
```
- انتبه: بدون `--remote` يحاول الاتصال بقاعدة محلية (Docker) ويفشل.
- لا تعدّل migration مطبقة. أي تغيير = ملف جديد بـ `supabase/migrations/`.

المطبق حالياً على `mukhdar-dev`: `20261110000001_init.sql`، `20261110000002_storage.sql` (T02)، `20261111000001_advisor_fixes.sql` (T03)، `20261111000002_review_fixes.sql` و`20261112000001_sequence_grants.sql` (مراجعة T01–T05)، `20261112000002_inactive_driver_orders.sql`، `20261112000003_push_dispatch.sql` (T07)، `20261112000004_delete_account.sql` (T08)، `20261114000001_address_wording.sql` (نص العنوان بالإشعارات: "وحدة A3 - عمارة 12"؛ طُبّقت 2026-11-14 بموافقة صاحب المشروع)، `20261115000001_order_status_ready.sql` و`20261115000002_ready_flow.sql` (حالة `ready` ومسار السائق؛ طُبّقتا 2026-11-14 بموافقة صاحب المشروع)، `20261115000003_push_reliability.sql` (موثوقية الإشعارات)، `20261115000004_hardening.sql` (push_tokens عبر الدالة فقط، قائمة وحدات البيع)، `20261115000005_deletion_safety.sql` (تسلسل القبول مع حذف الحساب، حفظ الحالة الأصلية)، `20261116000001_phone_pin_auth.sql` (الدخول بالهاتف + PIN: Send SMS hook يرفض، كل حساب برقم صالح، رقم فريد؛ طُبّقت 2026-11-14 بموافقة صاحب المشروع)، `20261117000001_signup_rate_limit.sql` (حدود معدل دالة `signup`؛ طُبّقت 2026-11-15 بموافقة صاحب المشروع)، `20261118000001_set_default_address.sql` (تعيين العنوان الافتراضي بمعاملة واحدة، security invoker؛ طُبّقت 2026-11-15 بموافقة صاحب المشروع)، `20261119000001_revoke_user_sessions.sql` (إبطال كل جلسات مستخدم لـ `admin-reset-pin`، service_role فقط؛ طُبّقت 2026-11-15 بموافقة صاحب المشروع)، `20261120000001_staff_delivery_fallback.sql` (الموظف أيضاً ← بالطريق/تم التوصيل كإجراء احتياطي بدل السائق؛ طُبّقت 2026-11-16 بموافقة صاحب المشروع)، `20261121000001_catalog_stock.sql` (T18: كلفة الحركات، رصيد افتتاحي بالدفتر، هدر/تسويات/صافي ربح بـ daily_stats، حد النقص وإشعار admins_only، دوال المنتجات والمخزون وسحب الكتابة المباشرة؛ طُبّقت 2026-11-16 بموافقة صاحب المشروع)، `20261122000001_admin_settings_staff.sql` (T19)، `20261123000001_account_lifecycle.sql` (مراجعة T16-T19 جلسة A: الرمز المؤقت الإجباري، التعطيل يُخرج من الأجهزة، سائق بطلبات، `admin_audit`، نقل طلب بالطريق، الإلغاء بلا إرجاع؛ طُبّقت 2026-11-16 بموافقة صاحب المشروع)، `20261124000001_review_session_b.sql` (جلسة B: `pin_resets.kind`، `admin_rate_hit`، الإشعارات عالق/فاشل/مصروف، قيد العمارة 1..100 وصلاحيات العناوين، `address_usage`؛ طُبّقت 2026-11-16 بموافقة صاحب المشروع)، `20261126000001_reports.sql` (T20: دوال التقارير `report_*` للأدمن، فهرسا التقارير، ومنع الحذف الفعلي لمنتج له تاريخ L4(أ)؛ طُبّقت 2026-11-16 بموافقة صاحب المشروع، على mukhdar-dev فقط)، `20261127000001_dashboard.sql` (T25: دالة `dashboard_today()` والفهرس الجزئي لـ `cancelled_at`؛ طُبّقت 2026-11-16 بموافقة صاحب المشروع، على mukhdar-dev فقط)، `20261128000001_ratings.sql` (T26: `rate_order` مشدَّد و`ratings_summary` و`ratings_list` وشارة الإشعارات العالقة بالرئيسية؛ طُبّقت 2026-11-16 بموافقة صاحب المشروع، على mukhdar-dev فقط)، `20261129000001_ratings_privacy.sql` (مراجعة C جلسة D: إزالة محارف bidi وغير المرئية من تعليق التقييم، `ratings_list` بلا اسم زبون محذوف، حذف `ratings_created_idx`؛ طُبّقت 2026-11-17 بموافقة صاحب المشروع، على mukhdar-dev فقط)، ثم migrations T23 (`20261130000001`، `20261201000001`، `20261202000001`)، و`20261203000001_definer_triggers.sql` (triggers تنظيف الاسم والعنوان SECURITY DEFINER؛ إصلاح بلاغ iOS Safari؛ طُبّقت 2026-11-18 بموافقة صاحب المشروع لهذه الجلسة، على mukhdar-dev فقط)، و`20261204000001_address_floor.sql` (الطابق بالعنوان ولقطة الطلب؛ طُبّقت 2026-11-18 بنفس الموافقة، على mukhdar-dev فقط).

## 4) توليد أنواع TypeScript

بعد كل migration جديدة:
```bash
pnpm sb gen types typescript --remote > packages/shared/src/database.types.ts
pnpm exec prettier --write packages/shared/src/database.types.ts
```

## 5) فحص Security Advisor

```bash
pnpm sb db advisors --remote
```
(أو من اللوحة: Advisors ← Security Advisor).

**آخر فحص (2026-11-15، للقراءة فقط، بعد كل migrations حتى `20261119000001`): 11 تحذيراً، نفس المقصودة أدناه بلا جديد** (`set_default_address` security invoker، و`revoke_user_sessions` لـ service_role فقط، فلا تظهران). دوال `private.*` و`begin/abort_account_deletion` و`claim/finish_push_notifications` لا تظهر (غير قابلة للتنفيذ من `authenticated`).

**آخر فحص (جلسة F، 2026-11-17، mukhdar-dev بعد `20261202000001`): 34 تحذيراً (WARN) + 5 ملاحظات INFO**: الـ 34 كما بالسطر التالي بلا تغيير (`panel_session_alive` الجديدة security invoker، و`claim_push_notifications` صارت definer لكنها service_role فقط، فلا تظهران)؛ والـ INFO هي `rls_enabled_no_policy` على جداول مقصود أنها بلا سياسة (لا وصول إلا من دوال definer): `private.deployment` (جديد، L3)، `private.panel_sessions`، `private.signup_rate_limits`، `public.admin_function_hits`، `public.notification_outbox`.

**العدد المتوقع بعد T23 (جلسة E2، 2026-11-17): 34 تحذيراً** = 33 دالة RPC مقصودة (`authenticated_security_definer_function_executable`؛ القائمة بـ `supabase/tests/01_schema.sql`، وأُضيف لها `admin_reset_mfa` بجلسة E1 و`admin_cancel_customer_orders` و`touch_panel_session` بجلسة E2) + `auth_leaked_password_protection`. أي رقم غير 34 أو تحذير باسم آخر = يُفحص قبل الإطلاق (L11).

نتيجة بعد مراجعة T01–T05 (2026-11-11): **10 تحذيرات مقصودة**: `authenticated_security_definer_function_executable` على دوال RPC العشر (`place_order`، `set_order_status`، `available_orders`، `accept_order`، `assign_driver`، `list_drivers`، `rate_order`، `register_push_token`، `adjust_stock`، `set_user_role`). هذه هي الواجهة الوحيدة للكتابة الحساسة (SPEC-backend §5)، وكل دالة تتحقق من `auth.uid()` والدور بداخلها.

بالإضافة: `auth_leaked_password_protection` (إعداد Auth). **مقصود ويبقى معطّلاً**: الـ PIN من 6 أرقام، وكل الأرقام تقريباً بقوائم التسريب، فتفعيله يرفض كل الرموز (ADR 0001).

أي تحذير جديد غير هذه = شيء يحتاج إصلاح. (اختبار `01_schema.sql` يفحص نفس القواعد تلقائياً.)

تاريخياً، نتيجة T02 كانت 64 تحذيراً، وأصلحتها migration `20261111000001_advisor_fixes.sql`:
- `search_path` ثابت للدوال الثلاث.
- دوال الأدوار security definer انتقلت لمخطط `private` (غير مكشوف بالـ API)، والأسماء بـ `public` صارت security invoker.
- السياسات تستخدم `(select auth.uid())` و `(select private.is_admin())`، وسياسات الأدمن `for all` انقسمت لـ insert/update/delete.

## 6) Auth: الدخول برقم الهاتف + PIN (خطوات يدوية من اللوحة)

> قرار صاحب المشروع (2026-11-14): **لا SMS ولا OTP**. الدخول برقم الهاتف + رمز PIN من 6 أرقام (كلمة سر Supabase)، ولا تُرسل أي رسالة. الأسباب والمخاطر: [ADR 0001](ADR/0001-phone-pin-auth.md).
> هذه تغييرات بإعدادات الخدمة السحابية: **يضبطها صاحب المشروع من اللوحة** (لا تُغيَّر من الكود). الـ migration `20261116000001_phone_pin_auth.sql` (دالة الـ hook وحماية الرقم) **مطبقة على mukhdar-dev (2026-11-14)**.
>
> **الحالة على mukhdar-dev (2026-11-15):** Phone + PIN يعمل (الدخول بالرمز فُحص بـ `pnpm it:signup`). خطوة 3 (Allow new users to sign up: **OFF**) نُفّذت 2026-11-15 وفُحصت (§14). اختبار `it:delete-account` يدخل بالبريد لمستخدم مؤقت (Email مفعّل على التطوير فقط).

لكل مشروع (التطوير والإنتاج)، بالترتيب:
1. Authentication ← **Hooks** ← **Send SMS hook** ← Add hook: النوع **Postgres**، المخطط `private`، الدالة **`hook_send_sms_reject`** ← Enabled.
   (يرفض كل رسالة: لا كلفة ولا OTP حتى لو ضُبط مزوّد SMS بالخطأ.)
2. Authentication ← Sign In / Providers ← **Phone**: **Enabled**، و**Enable phone confirmations: OFF**.
   إن رفضت اللوحة الحفظ بلا مزوّد SMS رغم تفعيل الـ hook: اختر Twilio واكتب قيماً وهمية (مثل `ACxxxxxxxx`)؛ لا تُستخدم أبداً لأن الـ hook يسبق المزوّد ويرفض.
3. نفس الصفحة ← **Allow new users to sign up: OFF** (قرار المالك 2026-11-15). **الترتيب مهم:** بعد نشر Edge Function `signup` ونجاح `pnpm it:signup` (§14)؛ وبعده `pnpm it:signup -- --signup-disabled`. الحسابات الجديدة من الدالة فقط (Admin API لا يتأثر بالإعداد).
4. Authentication ← Passwords (أو Policies): **Minimum password length = 6**، **Password requirements = No required characters**، **Leaked password protection = OFF** (كل الأرقام من 6 خانات تقريباً بقوائم التسريب، فتفعيله يرفض كل الرموز).
5. Authentication ← **Rate Limits** ← "sign-ups and sign-ins": **30 كل 5 دقائق لكل IP** (الافتراضي). **لا تخفّضه**: شبكات العراق تشارك IP واحداً بين زبائن كثيرين (CGNAT).
6. **الإنتاج فقط:** Sign In / Providers ← **Email: Disabled** (لا حسابات بالبريد ولا رسائل). بالتطوير يبقى مفعّلاً لاختبار `it:delete-account`.
7. لا Test OTPs بأي مشروع (احذفها إن وُجدت): كانت رموزاً ثابتة يدخل بها أي أحد.
8. **المصادقة الثنائية (T23 C1، قرار المالك 2026-11-17):** Authentication ← **Multi-Factor** ← **TOTP (App Authenticator): Enabled** (التسجيل والتحقق). مجاني، بلا SMS. **إلزامي للأدمن والموظف** بقاعدة البيانات (`current_user_role()` يطلب `aal2`، migration `20261130000001`)؛ السائق والزبون بلا تغيير. **الترتيب:** فعّل TOTP **قبل** تطبيق `20261130000001` (وإلا لا يستطيع أي أدمن التسجيل ويُقفل عن اللوحة حتى تفعيله). Phone MFA وWebAuthn: **OFF**.

**المصادقة الثنائية باللوحة (T23 C1):** أول دخول للأدمن أو الموظف بعد التفعيل ← صفحة `/mfa`: يمسح رمز QR بتطبيق مصادقة (Google Authenticator، Microsoft Authenticator، …) أو يكتب المفتاح اليدوي، ثم يكتب الرمز من 6 أرقام. كل دخول بعدها: الهاتف + PIN ثم رمز التطبيق. تغيير الـ PIN يطلب رمز التطبيق أيضاً. **حسابا العرض على التطوير والمكدس المحلي:** `seed:demo` يسجّل للأدمن `07000000001` والموظف `07000000002` عاملاً بسر **تجريبي ثابت** `MUKHDARDEVONLYTOTPSECRETNOTPROD2` (`scripts/lib/totp.mjs`، أو `E2E_TOTP_SECRET`) لتدخل اختبارات e2e بـ aal2؛ أضفه بتطبيق المصادقة يدوياً للدخول بهما من المتصفح. **منشور بالـ repo: تطوير والمكدس المحلي فقط، أبداً الإنتاج** (`seed:demo` يرفض غير التطوير). حسابا العرض الحاليان على mukhdar-dev أُنشئا قبل T23 بلا عامل: يسجّلان من `/mfa` بأول دخول (أو `seed:reset` ثم `seed:demo` بموافقة، فيأخذان السر التجريبي).

**التحقق بعد الضبط (التطوير):** `pnpm seed:reset -- --remote && pnpm seed:demo -- --remote` (بموافقة)، ثم الدخول من التطبيق بأدمن العرض `07000000001` والرمز `DEMO_PIN` (أدناه)؛ ومحاولة `signInWithOtp` يجب أن تفشل.

**رمز العرض (التطوير فقط):** كل مستخدمي `seed:demo` (عرض وحمل) يدخلون بنفس الـ PIN: **`482915`** (`DEMO_PIN` بـ `scripts/lib/demo.mjs`). منشور بالـ repo، فلا يُستخدم بالإنتاج أبداً (`seed:demo` يرفض غير التطوير). مستخدمو العرض الحاليون على mukhdar-dev أُنشئوا قبل هذا التغيير **بلا رمز**: يحتاجون `seed:reset` ثم `seed:demo`.

**رمز سائقي العرض (T23 L6):** حسابات السائقين التجريبية `07000000011..13` فقط لها رمز مستقل **`739164`** (`DRIVER_DEMO_PIN` بـ `scripts/lib/demo.mjs`، أو `DRIVER_DEMO_PIN=<6 أرقام>` قبل `seed:demo` لتدويره)؛ يعيّنه `seed:demo` عند كل تشغيل. **هذا (لا `DEMO_PIN`) هو ما يُسلَّم لمطوّر تطبيق السائق**، فلا يدخل بأدمن العرض أو موظفه. تطوير فقط، لا يُستخدم بالإنتاج.

**الإساءة والتخمين:** لا قفل لكل حساب على خطتنا. راقب Authentication ← Logs (محاولات `invalid_credentials` متكررة لنفس الرقم أو كثرة 429). إن ظهرت إساءة: عطّل الحساب المستهدف مؤقتاً من اللوحة إن احتجت، وراجع خطة ADR 0001 (CAPTCHA، T23).

**حساب مراجعي Apple (الإنتاج):** رقم ثابت + PIN يُكتب بملاحظات المراجعة، بدور `customer` فقط.

**مراقبة التخمين وCAPTCHA (T23 M1، قرار المالك 2026-11-17):** **لا CAPTCHA عند الإطلاق** (`signup` محمي بـ 20/ساعة لكل IP و5/ساعة لكل رقم، وللدخول حدود Auth بالـ IP). المطلوب:
1. احفظ بـ Logs Explorer استعلام Auth للمحاولات الفاشلة (`invalid_credentials`) مجمّعة بالرقم، وآخر لموجات `429`. افتح كلاً منهما **يومياً أول أسبوعين ثم أسبوعياً**.
2. **علامة التشغيل:** 10 محاولات فاشلة أو أكثر لنفس الرقم بساعة، أو أكثر من 20 رقماً مختلفاً يفشل من نفس IP بساعة، أو موجة `429` غير مفسَّرة، أو حسابات جديدة مشبوهة بالجملة.
3. عند العلامة: فعّل **Cloudflare Turnstile** من Auth ← Attack Protection (CAPTCHA) واربط مفتاح الموقع بصفحة الدخول والتسجيل (يحتاج تعديل `signup` وتطبيق الزبون: مهمة مستقلة بموافقة المالك)، وأعد ضبط الحدود. قبلها، للطوارئ: عطّل الحساب المستهدف (`set_user_role`) أو ارفع طول الرمز بإعادة ضبط يدوية.

## 7) إنشاء أول أدمن، ونسيان رمز أدمن

1. سجّل حساباً بالهاتف + PIN من تطبيق الزبون (بعد T10)، أو بالتطوير استخدم أدمن العرض `9647000000001` (`seed:demo`).
   **الإنتاج:** برقم هاتف حقيقي لصاحب المشروع وبرمز غير سهل لا يعرفه غيره.
   الـ trigger `on_auth_user_created` ينشئ له `profiles` بدور `customer`.
2. من SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where phone = '9647XXXXXXXXX';
   ```
   Supabase يخزن `auth.users.phone` **بدون `+`** (`9647XXXXXXXXX`)، والـ trigger ينسخه كما هو. تأكد بـ:
   ```sql
   select id, phone, role from public.profiles;
   ```
3. **أدمن نسي رمزه، أو فقد تطبيق المصادقة** (إعادة الضبط من اللوحة لا تشمل حسابات الأدمن، SPEC-admin §2.6): صاحب المشروع من **جهازه** بالسكربت المحلي، لا من SQL Editor ولا بأي رسالة:
   ```bash
   pnpm admin:break-glass-reset 07XXXXXXXXX              # نسي الـ PIN (التطبيق معه)
   pnpm admin:break-glass-reset 07XXXXXXXXX --mfa-only   # فقد هاتف/تطبيق المصادقة (يعرف الـ PIN)
   pnpm admin:break-glass-reset 07XXXXXXXXX --with-mfa   # الاثنان
   ```
   - **المصادقة الثنائية (T23 C1):** `--mfa-only` و`--with-mfa` يستدعيان `break_glass_reset_mfa` (service_role، أدمن فقط): تحذف عوامل TOTP للأدمن، تبطل كل جلساته، وتكتب `admin_audit` (`action = 'mfa_reset'`، `actor` فارغ، `after.via = 'break_glass'`). `--mfa-only` لا يغيّر الـ PIN ولا يطبع شيئاً سرياً. أول دخول بعدها ← `/mfa` يسجّل تطبيقاً جديداً. **لا يمكن** إعادة مصادقة أدمن من اللوحة (`ADMIN_ACCOUNT`). تحقق قبل التشغيل أن الطلب من صاحب الحساب نفسه بمكالمة (لا رسالة).
   - **الإعداد مرة واحدة:** بـ `.env.local` بجذر المشروع (مُتجاهل بـ git، لا يُنسخ لمكان آخر؛ القالب `.env.example`) سطران: `SUPABASE_SERVICE_ROLE_KEY=<مفتاح service_role>` و`SUPABASE_URL=https://<ref>.supabase.co` (أو مرّر `SUPABASE_URL` بالبيئة). السكربت **يرفض العمل** إن غاب أحدهما. المفتاح لا يُستعمل بأي مكان آخر (ولا بالمتصفح ولا بالتطبيقات).
   - يطبع المشروع المستهدف والرقم ويسأل `[y/N]`؛ مشروع غير mukhdar-dev يتطلب كتابة معرّفه كاملاً أولاً. **يقبل حساب أدمن فقط** (غيره: "إعادة ضبط رمز الدخول" من اللوحة).
   - يولّد رمزاً عشوائياً من 6 أرقام، يضبطه، **يبطل كل جلسات الحساب**، يضبط `must_change_pin` (يُجبر على تغييره أول دخول)، ويكتب سطر تدقيق `pin_resets` بـ `kind = 'break_glass'` (بلا `reset_by`). الرمز يظهر **مرة واحدة على الشاشة فقط** ويُمسح بـ Enter؛ لا يُكتب بأي ملف ولا سجل ولا بسطر الأوامر.
   - **سلّم الرمز للأدمن بمكالمة هاتفية**، لا واتساب ولا رسالة ولا SQL Editor ولا لقطة شاشة. فشل بعد تغيير الرمز يطبع الخطوة الفاشلة بلا الرمز: أعد التشغيل (آمن؛ يولّد رمزاً جديداً).
   - **طرفية حقيقية فقط (جلسة C، M4):** السكربت **يرفض العمل** إن لم يكن `stdin` و`stdout` كلاهما طرفية حقيقية (لا `echo y |` ولا `| tee` ولا `> ملف` ولا CI ولا مسجّل شاشة)، وإن وُجد متغير `CI`؛ فلا يبقى الرمز بسجل ولا يُؤكَّد برمجياً. الاستثناء الوحيد للاختبار: `MUKHDAR_BREAK_GLASS_TEST=1` **مع** مشروع mukhdar-dev (يستعمله `it:break-glass`). انقطاع الشبكة بأي خطوة يطبع "فشلت الخطوة" بلا الرمز (أعد التشغيل).
   - **التحقق (التطوير):** `pnpm it:break-glass` ينشئ أدمناً مؤقتاً (بادئة 9647007) ويشغّل السكربت عملياً ثم يحذف كل شيء.
   - **آخر ملاذ بلا جهاز المالك:** لا SQL بنص الرمز. من جهاز المالك فقط، بنفس السكربت. (قديماً: `update auth.users set encrypted_password = crypt(...)` بـ SQL Editor؛ أُلغي لأنه يترك الرمز بسجل الاستعلامات ولا يدقّق ولا يبطل الجلسات إلا بسطر ثانٍ.)
4. نسيان رمز زبون أو موظف أو سائق: من لوحة الأدمن، "إعادة ضبط رمز الدخول" (`admin-reset-pin`، T19)، **بشروط التحقق (T23 M2، قرار المالك 2026-11-17) قبل أي ضبط:**
   - **الرسالة من الرقم المسجّل نفسه** (رقم رأس محادثة الواتساب يطابق رقم الحساب؛ لا اسماً ولا رسالة محوّلة ولا لقطة شاشة).
   - **الزبون يجاوب سؤالين عن آخر طلب له:** المبلغ التقريبي والعنوان (وحدة وعمارة). غلطة بواحد = لا ضبط.
   - **حساب الأدمن لا يُضبط من واتساب أبداً** (سكربت الطوارئ من جهاز المالك فقط، الخطوة 3).
   - **الموظف والسائق:** لا ضبط من الرسالة وحدها؛ **اتصل بالرقم المسجّل** وتأكد منه بالمكالمة ثم اضبط.
   - "عندي رقم جديد" ليس سبباً للضبط: يفتح حساباً جديداً، وتغيير رقم حساب قائم يتطلب تحققاً مباشراً (مكالمة) ثم عملاً يدوياً.
   - سلّم الرمز المؤقت بـ **"نسخ الرمز"** والصقه بنفس المحادثة (رابط واتساب يترك الرمز بسجل المتصفح)، وأبلغ الشخص أن الضبط أخرجه من كل أجهزته؛ إن لم يكن هو من طلب، عطّل الحساب فوراً.
5. **ترقية حساب قائم لموظف أو أدمن (T23 F M2، قرار المالك 2026-11-17):** `set_user_role` يرفض ترقية زبون أو سائق بـ `PIN_RESET_REQUIRED` ما لم يكن رمزه مؤقتاً. الترتيب: (1) تحقق من الشخص بمكالمة؛ (2) الموظفون والسواق ← "تصفير الرمز"؛ (3) غيّر الدور (الترقية تحذف أي عامل TOTP قديم ورموز إشعاراته)؛ (4) سلّمه الرمز المؤقت **حضورياً إن أمكن**؛ (5) أول دخول ← `/change-pin` (بلا رمز تطبيق) ← ثم `/mfa` يسجّل التطبيق، ويفضّل أن يكون ذلك أمامك. أي عامل TOTP سُجّل أثناء الرمز المؤقت يُحذف عند تغيير الرمز (`mfa_reset`، `via = 'temporary_pin_window'`). الحساب الجديد من "إضافة موظف" يمر بنفس المسار تلقائياً. لأدمن جديد بالترقية: نفس الترتيب، ثم سكربت الطوارئ بـ `--with-mfa` مستحسن إن شُك بالجهاز.
6. **موظف فقد هاتف تطبيق المصادقة (T23 C1):** بعد التحقق منه بمكالمة، الأدمن: الموظفون والسائقون ← سطر الموظف ← **"إعادة ضبط المصادقة الثنائية"** ← تأكيد. يحذف عوامله (`admin_reset_mfa`)، يخرجه من كل الأجهزة، ويُسجَّل بـ `admin_audit` (`mfa_reset`، `after.via = 'panel'`). أول دخول بعدها يسجّل تطبيقاً جديداً. إن نسي الـ PIN أيضاً: "تصفير الرمز" كذلك (مستقلان). السائق والزبون بلا مصادقة ثنائية.

## 7b) اختبار الحمل (T22)
`pnpm load:run` (كامل ~55 دقيقة؛ `-- --smoke` للفحص السريع) و`pnpm load:cleanup` عند انقطاعه. على mukhdar-dev فقط، ببيانات مؤقتة تُحذف وتُثبت بلقطة قبل/بعد. التفاصيل: `scripts/load/README.md`، النتائج: `docs/reviews/load-test-T22.md`.

## 8) اختبارات قاعدة البيانات (pgTAP، T03)

الملفات: `supabase/tests/NN_*.sql` (33 ملفاً، 1315 فحصاً على mukhdar-dev بعد `20261204000001`؛ `33_address_floor.sql` الطابق؛ `32_real_role_writes.sql` كل كتابة بالدور الحقيقي وحارس الصنف آلياً؛ `27_access_matrix.sql` مصفوفة الأدوار × دوال T20/T25/T26، `28_mfa_aal.sql` كل دالة أدمن/موظف بـ aal1 مقابل aal2، `29_order_caps.sql` حدّا الطلب)، والدوال المساعدة `supabase/tests/_helpers.sql`، والمشغّل `scripts/db-test.mjs`.

- كل ملف يعمل داخل `BEGIN ... ROLLBACK`: امتداد `pgtap` ومخطط `tests` وبيانات الاختبار كلها تُنشأ داخل المعاملة وتُلغى. **لا يبقى شيء بقاعدة البيانات**، ولا حاجة لتفعيل pgtap بشكل دائم.
- لا نستخدم `supabase test db` محلياً لأنه يحتاج Docker.

### على مشروع التطوير (من ويندوز)
```bash
pnpm db:test:remote          # كل الملفات
pnpm db:test:remote 03 04    # ملفات محددة
pnpm db:test:remote --prelude=supabase/migrations/<new>.sql   # migration غير مطبّقة، تُنفَّذ داخل معاملة كل ملف وتُلغى
```
يحتاج:
1. `supabase link` (يوفر `supabase/.temp/pooler-url`).
2. `SUPABASE_DB_PASSWORD` بـ `.env.local`.
3. شهادة **Supabase Root 2021 CA** بـ `supabase/certs/prod-ca-2021.crt` (مرفوعة بالـ git؛ شهادة عامة). المصدر: Dashboard ← Project Settings ← Database ← SSL Configuration ← Download certificate. الاتصال يتحقق من الشهادة بالكامل.
   بصمة SHA-256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA` (صالحة حتى 2031-04-26).

### في CI
وظيفة `db-tests` بـ `.github/workflows/ci.yml`، على Supabase محلي (Docker على runner GitHub، تُطبَّق الـ migrations و`seed.sql` تلقائياً). **لا اتصال بالسحابة ولا كلمة سر بـ GitHub.** الخطوات:
1. `pnpm db:test` على البيانات الأساسية.
2. `pnpm db:concurrency`: تزامن حقيقي باتصالات متعددة (40 طلباً على رصيد 10 ← 10 تنجح بالضبط بلا deadlocks؛ 8 سائقين يقبلون نفس الطلب ← واحد فقط؛ 4 عمال push-dispatch يحجزون من الصندوق بنفس اللحظة ← مجموعات منفصلة). ينشئ بياناته فعلاً ثم يحذفها، لذلك **يرفض أي قاعدة غير محلية** (لا يعمل على `mukhdar-dev`).
3. `seed:demo --scale=load`، ثم `pnpm db:test` مرة ثانية، ثم `pnpm db:report-perf` (T20: سنة من البيانات، 200 ألف طلب و800 ألف بند، داخل معاملة تُلغى؛ كل دالة تقارير لشهر < 500ms ومجموع الصفحة < 1 ثانية، ولسنة < 2 ثانية)، ثم `seed:reset` و`db:test 09`.
4. التأكد أن `seed:demo` و`db:concurrency` يرفضان هدفاً غير محلي (مع نص الرفض).

وظيفة `ci` تشغّل أيضاً `pnpm test:functions` (`deno check` + `deno test` لـ Edge Functions، fetch مزيف). Deno يُنزَّل عبر `devEngines` بـ `package.json` (مثبّت 2.9.6).

الـ actions مثبّتة بـ commit SHA، ولكل وظيفة `timeout-minutes`، ودفعة جديدة تلغي التشغيل القديم لنفس الفرع.

### Supabase المحلي (`supabase/config.toml`)
مثل الإنتاج المقصود: الدخول **بالهاتف + PIN فقط** (email معطّل، تأكيد الهاتف معطّل، `[auth.hook.send_sms]` يرفض كل رسالة، بلا Test OTPs). هذا للمكدس المحلي فقط؛ إعدادات Auth السحابية تُدار من اللوحة (§6).

### كتابة اختبار جديد
- `tests.as_user(uid)` تحاكي جلسة **aal2** (افتراضياً، T23)، و`tests.as_user_aal1(uid)` جلسة الـ PIN وحده.
- `tests.new_user(role)`، `tests.new_product(price, stock, active, cost)`، `tests.new_address(customer)`، `tests.place(customer, items)`، `tests.order_in(status, customer, driver)` للتجهيز (بدور postgres).
- `tests.as_user(uid)` / `tests.as_anon()` / `tests.as_postgres()` للتبديل. `tests.remember(name, id)` و `tests.id(name)` لحفظ المعرّفات بين الأدوار.
- `tests.try(sql)` يرجع `OK` أو رمز الخطأ، و`tests.affected(sql)` يرجع عدد الصفوف المتأثرة (لاختبار RLS على update/delete).
- الدوال الجديدة لا تُنفَّذ افتراضياً من `PUBLIC`: دالة تُنشأ داخل ملف اختبار (بعد `_helpers.sql`) أنشئها واستدعها بدور postgres (`tests.as_postgres()`).
- `select plan(N)` يجب أن يساوي عدد الفحوص، والمشغّل يفشل إذا اختلف.

## 9) فحص place_order السريع (T02)

الملف: `supabase/scripts/smoke_place_order.sql`. يعمل كله داخل معاملة تنتهي بـ `ROLLBACK`، فلا يترك أي بيانات.
يفحص: طلب صحيح بمجموع محسوب من القاعدة (السعر المرسل من التطبيق يُتجاهل)، تكرار نفس مفتاح idempotency، رفض عنوان زبون آخر، رفض كمية أكبر من المخزون، منع الزبون من قراءة المخزون وسعر الشراء، ونقص المخزون فعلاً.

```bash
pnpm sb db query --remote -f supabase/scripts/smoke_place_order.sql --yes
```
النجاح: يرجع صفاً واحداً `"result": "SMOKE OK"`. الفشل: خطأ يبدأ بـ `SMOKE FAIL` أو اسم الخطأ.

من SQL Editor باللوحة: الصق محتوى الملف كاملاً وشغّله. النتيجة نفسها.

## 10) البيانات التجريبية (seed، T05)

**للتطوير فقط.** السكربتات ترفض أي مشروع غير `mukhdar-dev` (قائمة مسموحة بـ `scripts/lib/db.mjs`)، وترفض إذا `MUKHDAR_ENV=production`، وترفض أي `DB_URL` غير محلي.

### 1. البيانات الأساسية: `supabase/seed.sql`
مدينة بسماية، قطاعان (A، B) × وحدات (A1..A9، B1..B8 = 17) × عمارات 1..100 لكل وحدة = **1700 عمارة**، 6 أقسام، 60 منتجاً (الخضار والفواكه بوحدة "نص كيلو"، الأعشاب "باقة") بأسعار شراء ورصيد ابتدائي.
- محلياً تُحمَّل تلقائياً مع `supabase start` / `db reset`.
- على mukhdar-dev (قابلة للإعادة، لا تكرر ولا تغيّر ما عدّله الأدمن):
  ```bash
  pnpm sb db query --remote -f supabase/seed.sql --yes
  ```
- الهيكل من قرار المالك (2026-11-14). `seed.sql` لا يحذف شيئاً ولا يعدّل منتجاً موجوداً؛ لتغيير الهيكل أو الكتالوج على `mukhdar-dev` انظر "إعادة بناء الكتالوج والعناوين" أدناه.

### 2. بيانات العرض: `pnpm seed:demo`
```bash
pnpm seed:demo -- --remote                  # mukhdar-dev (حوالي 4 دقائق)
pnpm seed:demo -- --remote --scale=load     # + 1000 زبون لاختبار الحمل (T22)
pnpm seed:demo -- --remote --images-only    # صور المنتجات فقط
pnpm seed:reset -- --remote                 # يمسح بيانات العرض فقط
```
- المستخدمون: أدمن `9647000000001`، موظف `9647000000002`، سائقون `9647000000011..13`، زبائن `9647000000101..120`، الحمل `9647001000001..`. البادئة 7000/7001 ليست لأي شركة عراقية.
  الدخول: الرقم (مثلاً `07000000001`) + رمز العرض `DEMO_PIN` = `482915` (§6؛ تطوير فقط). يعمل على mukhdar-dev بعد ضبط إعدادات §6.
- 500 طلب على 30 يوماً (أغلبها مسلّم، 12% ملغى، 55% من المسلّم مقيّم، وطلبات اليوم نشطة). كل الطلبات وتحويلاتها **عبر دوال RPC**، ثم تُرجَع طوابعها الزمنية لأيامها ويُنقل أثرها بـ `daily_stats` لنفس اليوم.
- إشعارات العرض تُعلَّم كمرسلة (لا يرسلها push-dispatch).
- السكربت يرفض العمل إذا كانت بيانات العرض موجودة: شغّل `seed:reset` أولاً.
- في النهاية يفحص أن `daily_stats` يطابق الطلبات المسلّمة والملغاة لكل يوم (نفس فحص `09_daily_stats.sql`).

### إعادة بناء الكتالوج والعناوين على mukhdar-dev (عند تغيير قرار تجاري)
بموافقة صاحب المشروع فقط. بالترتيب:
1. `pnpm seed:reset -- --remote` (يحذف مستخدمي العرض وطلباتهم ويعكس أثرها).
2. تأكد أنه لا توجد طلبات ولا عناوين لغير مستخدمي العرض، ثم امسح بمعاملة واحدة: `addresses` ← `buildings` ← `subsections` ← `sectors`، و`products` (تمتد للتكاليف والمخزون والحركات) ← `categories`، وصور `product-images/demo/`.
3. `pnpm sb db query --remote -f supabase/seed.sql --yes`، ثم `pnpm seed:demo -- --remote` (يرفع الصور أيضاً).

آخر تنفيذ: 2026-11-14 (وحدة نص كيلو + قطاعان A/B بـ 17 وحدة).

### 3. `seed:reset`
يحذف مستخدمي العرض/الحمل (بالبادئة) وطلباتهم وعناوينهم وإشعاراتهم، ويطرح مساهمتهم من `daily_stats`، ويعكس حركات المخزون التي أنشأوها. لا يمس الكتالوج ولا الصور. كله بمعاملة واحدة، ويُلغى إذا لم يتطابق `daily_stats` بعده.

### 4. صور المنتجات
تحتاج مفتاح `service_role` لمشروع **التطوير** (رفع عبر Storage API). يضعه صاحب المشروع بنفسه بـ `.env.local` (مُتجاهل بـ git):
```
SUPABASE_SERVICE_ROLE_KEY=...   # Dashboard ← Project Settings ← API Keys ← service_role
```
ثم `pnpm seed:demo -- --remote --images-only`. بدون المفتاح تُتخطى الصور برسالة. **لا يوضع هذا المفتاح أبداً بتطبيق أو بكود يعمل بالمتصفح.**

### الحالة على mukhdar-dev (2026-11-14)
أُعيد البناء بعد قرارَي المالك (وحدة نص كيلو، قطاعان A/B): `seed.sql` الجديد (قطاعان، 17 وحدة، 1700 عمارة، 60 منتجاً منها 33 بنص كيلو) و`seed:demo`: 25 مستخدماً، 500 طلب، `daily_stats` متطابق، صور المنتجات 60/60 (تُعرض بالرابط العام).

2026-11-14 (بموافقة صاحب المشروع): `seed:reset` ثم `seed:demo` بمسار `ready`: 500 طلب (427 مسلّم، 53 ملغى، وطلبات اليوم: 7 `pending` بلا سائق، 4 `preparing`، 3 `ready` بانتظار سائق، 6 `out_for_delivery`)، `daily_stats` متطابق، لا إشعارات معلّقة.

### مخاطرة معروفة: الكتابة المباشرة بجداول Auth
`seed:demo` ينشئ المستخدمين بإدراج مباشر في `auth.users` و`auth.identities` (هاتف مؤكد، أعمدة الرموز نصوص فارغة)، لأن الطلبات يجب أن تمر بـ `place_order` بهوية كل مستخدم (SPEC-backend افتراض 19). هذه جداول داخلية لـ Supabase Auth وقد يتغير شكلها مع تحديثات Supabase بدون إعلان:
- **العَرَض:** فشل `seed:demo` بخطأ عمود/قيد بـ `auth.*`، أو مستخدمو عرض لا يستطيعون الدخول.
- **الإجراء:** قارن أعمدة `auth.users`/`auth.identities` الحالية بـ `CREATE_USERS_SQL` بـ `scripts/seed-demo.mjs` وعدّلها. البديل الأكثر ثباتاً: إنشاء المستخدمين عبر Auth Admin API (`service_role`) ثم بقية البيانات بالاتصال المباشر.
- CI يكشفها مبكراً لأن وظيفة `db-tests` تشغّل `seed:demo` على أحدث Supabase محلي.

## 11) الإشعارات: Edge Function `push-dispatch` (T07)

**المسار:** دالة تكتب بـ `notification_outbox` ← trigger (مرة واحدة لكل معاملة؛ فشله لا يُفشل المعاملة) يستدعي `private.push_kick_post()` ← `pg_net` يرسل `POST` (بعد commit) لرابط الدالة مع ترويسة `x-dispatch-secret` ← الدالة تتحقق من السر (`push_dispatch_authorized`)، تحجز الصفوف (`claim_push_notifications`)، ترسل عبر Expo، وتسجل النتيجة (`finish_push_notifications`). احتياط: `pg_cron` job باسم `push-dispatch` كل دقيقة (يطلب الدالة فقط إن بقي شيء غير مرسل)، و`push-history-purge` يومياً 00:30 UTC (يحذف سجل cron أقدم من 7 أيام والإشعارات المنتهية أقدم من 30 يوماً). دفعة تخلط رموز مشروعَي Expo (الزبون والسائق) تُقسَّم حسب المشروع تلقائياً.

### النشر (لكل بيئة، بموافقة صاحب المشروع)
```bash
pnpm sb db push --remote --yes                       # migration 20261112000003 (pg_net، pg_cron، السر بـ Vault)
pnpm sb functions deploy push-dispatch --remote=<ref> --use-api --no-verify-jwt --yes
```
ثم رابط الدالة بـ Vault (مرة واحدة لكل بيئة؛ من SQL Editor أو اتصال القاعدة):
```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url',
                           'push-dispatch Edge Function URL');
-- لتغييره: select vault.update_secret((select id from vault.secrets where name = 'push_dispatch_url'), '<url>');
```
- **السر المشترك** `push_dispatch_secret` يولّده الـ migration داخل Vault (32 بايت عشوائية)؛ لا يُنسخ لأي مكان. لتدويره: `vault.update_secret` بقيمة جديدة عشوائية (الدالة تقرؤه من القاعدة بكل طلب، فلا حاجة لإعادة النشر).
- **أسرار الدالة:** `SUPABASE_URL` والمفاتيح تحقنها Supabase تلقائياً (الجديد `SUPABASE_SECRET_KEYS` أولاً والقديم احتياطاً، T23 F H2). نداء `pg_net` لا يحمل أي مفتاح (سر `x-dispatch-secret` فقط)، فلا يتأثر بإطفاء المفاتيح القديمة. `EXPO_ACCESS_TOKEN` **اختياري**: يُضبط فقط إن فُعّل "Enhanced push security" بحساب Expo (`supabase secrets set EXPO_ACCESS_TOKEN=... --remote=<ref>`؛ يضبطه صاحب المشروع بنفسه).
- محلياً و CI: لا `push_dispatch_url` ← لا طلبات HTTP (الـ trigger والـ cron لا يفعلان شيئاً).

### الحالة على mukhdar-dev (2026-11-12)
الـ migration مطبّق، الدالة منشورة (`verify_jwt = false`)، `push_dispatch_url` مضبوط، `EXPO_ACCESS_TOKEN` غير مضبوط (غير مطلوب). فحص طرفي: صف بالصندوق لمستخدم برمز Expo وهمي + رمز fcm ← عولج خلال ≈ 4 ثوانٍ عبر Expo الحقيقي (`DeviceNotRegistered` ← حُذف الرمز؛ fcm ← "skipped (provider not implemented)")، ثم حُذفت بيانات الفحص. **فحص جهاز حقيقي خلال 10 ثوانٍ مؤجل لـ T14.**

2026-11-14 (بموافقة صاحب المشروع): `20261115000003_push_reliability.sql` مطبّق والدالة أُعيد نشرها (تقسيم مشاريع Expo)، ثم أُعيد نشرها مع `delete-account` بـ supabase-js المثبّت 2.119.0 (فحص طرفي ✓، `it:delete-account` ✓). فحص طرفي: صف `admins` بلا رموز ← عولج خلال ≈ 4 ثوانٍ (`no recipients`) ثم حُذف.

### المراقبة
```sql
-- غير المرسل والأخطاء الأخيرة
select id, audience, attempts, claimed_at, last_error, created_at from public.notification_outbox
 where sent_at is null order by id desc limit 20;
-- ردود الدالة (pg_net يحتفظ بها ~6 ساعات)
select id, status_code, left(content, 200), error_msg, created from net._http_response order by id desc limit 10;
-- تشغيلات cron
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'push-dispatch') order by start_time desc limit 10;
```
سجلات الدالة: Dashboard ← Edge Functions ← push-dispatch ← Logs (`push-dispatch done {...}`).
- صف بـ `attempts = 5` لن يُعاد. لإعادته يدوياً: `update public.notification_outbox set attempts = 0, claimed_at = null where id = ...`.
- `401` بـ `net._http_response`: السر بـ Vault تغيّر أو الرابط يشير لمشروع آخر.
- **تكرار ممكن (N4):** إن قبل Expo الرسائل ثم فشل `finish_push_notifications` (انقطاع، مهلة الدالة)، يبقى الصف محجوزاً ويُعاد إرساله بعد 5 دقائق، فيصل الإشعار مرتين. نادر ومقبول بالمرحلة الأولى؛ الحل لاحقاً حفظ معرّفات تذاكر Expo. الإيصالات (receipts) مؤجلة (SPEC-backend افتراض 28)، وتُراجع قبل الإطلاق.

## 12) حذف الحساب: Edge Function `delete-account` (T08)

يستدعيها التطبيق بـ JWT المستخدم (`supabase.functions.invoke('delete-account', { method: 'POST' })`). لا أسرار إضافية (`SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` محقونة).

```bash
pnpm sb db push --remote --yes          # migration 20261112000004
pnpm sb functions deploy delete-account --remote=<ref> --use-api --no-verify-jwt --yes   # T23 F H2: التحقق بالدالة (auth.getUser)
```

### اختبار التكامل (مشروع التطوير فقط)
```bash
pnpm it:delete-account
```
ينشئ مستخدماً مؤقتاً (هاتف `9647005xxxxxx` + بريد `t08-…@example.com`، كلمة سر عشوائية) عبر Auth Admin API، يجرّب الرفض والحذف عبر الدالة المنشورة، ويحذف كل ما أنشأه حتى عند الفشل. يحتاج `SUPABASE_DB_PASSWORD` و`SUPABASE_SERVICE_ROLE_KEY` بـ `.env.local`. ليس بـ CI (يحتاج الدالة المنشورة ومفتاح الخدمة). يدخل المستخدم المؤقت بالبريد (Email مفعّل على التطوير فقط؛ معطّل بالإنتاج، §6)، لأن الاختبار يخص الحذف لا طريقة الدخول.

### الحالة على mukhdar-dev (2026-11-12)
الـ migration مطبّق والدالة منشورة. اختبار التكامل: 15/15، بلا بقايا.

### مستخدم يملك ملفات بـ Storage (N9)
`auth.admin.deleteUser` يرفض حذف مستخدم يملك كائنات بـ Storage (`storage.objects.owner`). اليوم يرفع الأدمن فقط صور المنتجات، والأدمن لا يُحذف من التطبيق أصلاً، فلا أثر الآن. إن صار غير الأدمن يرفع ملفات لاحقاً (أو احتجت حذف أدمن رفع صوراً): انقل ملكية كائناته أولاً (`update storage.objects set owner = null where owner = '<id>'` من SQL Editor) ثم احذفه. حذف الكائنات نفسها عبر Storage API لا بـ SQL.

### حذف حساب أدمن (يدوياً)
الدالة ترفض حساب `admin`. لحذفه: أنزل دوره أولاً من أدمن آخر (`set_user_role`)، ثم يحذف حسابه من التطبيق، أو احذفه من Dashboard ← Authentication ← Users.

## 13) تطبيق الزبون (T09)

**مرة واحدة:** أنشئ `apps/customer/.env` (انسخ `.env.example`):
```
EXPO_PUBLIC_SUPABASE_URL=https://ghcohlrzvehtcettaaiu.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # Dashboard ← Project Settings ← API Keys ← Publishable key
EXPO_PUBLIC_SENTRY_DSN=                                   # فارغ = Sentry معطّل
EXPO_PUBLIC_SHOP_WHATSAPP=9647XXXXXXXXX                   # رقم واتساب المتجر ("نسيت الرمز؟"، "تواصل عبر واتساب")؛ القيمة الوهمية = الرابط مخفي
EXPO_PUBLIC_SHOP_PHONE=                                   # T15: رقم اتصال المتجر (07… أو 9647…)؛ فارغ = زر "اتصل بالمحل" مخفي
EXPO_PUBLIC_PRIVACY_URL=                                  # T15: رابط https لسياسة الخصوصية (لازم لـ iOS قبل النشر)؛ فارغ = مخفي
EXPO_PUBLIC_TERMS_URL=                                    # T15: رابط https للشروط؛ فارغ = مخفي
EAS_PROJECT_ID=                                           # T14، اختياري: معرّف مشروع EAS (`eas init`، ليس سراً)؛ فارغ = لا رمز Expo Push
GOOGLE_SERVICES_JSON=                                     # T14، اختياري: مسار google-services.json (FCM أندرويد)؛ بـ EAS متغير من نوع ملف
```
`EAS_PROJECT_ID` و`GOOGLE_SERVICES_JSON` يقرأهما `app.config.ts` وقت البناء فقط (بلا بادئة `EXPO_PUBLIC_`، فلا يُضمَّنان بكود التطبيق). الإشعارات البعيدة تحتاج development build (Expo Go لا يستقبلها).
**التشغيل** (من جذر المستودع): `pnpm --filter @mukhdar/customer start`، ثم امسح رمز QR بتطبيق **Expo Go** (SDK 58) على نفس شبكة الـ Wi-Fi. إن لم يتصل الهاتف (شبكة مختلفة/جدار حماية): `pnpm --filter @mukhdar/customer start -- --tunnel`. بعد تعديل `.env`: أعد التشغيل مع `-- --clear`.

- أول فتح بـ Expo Go قد يعيد التحميل مرة واحدة لتفعيل RTL (طبيعي).
- الرئيسية تعرض "حالة المتجر" من `app_settings` (اختبار الاتصال). رسالة "إعداد الاتصال ناقص" = `.env` غير موجود أو ناقص.
- `expo export` محلياً يحتاج ذاكرة أكبر لـ Node على هذا الجهاز: `NODE_OPTIONS=--max-old-space-size=6144`.
- الاختبارات: `pnpm --filter @mukhdar/customer test` (jest-expo + RNTL)، وهي ضمن `pnpm test` و CI.
- **E2E على المتصفح (2026-11-18):** `apps/customer/e2e` (Playwright، مشروعان: `webkit-iphone` = Safari الآيفون، و`chromium-android`). المسار: تسجيل ← الاسم ← أول عنوان ← إضافة للسلة ← تأكيد الطلب ← إلغاؤه ← الاسم بحسابي ← حذف الحساب. **يكتب على mukhdar-dev** (حساب مؤقت بالبادئة `9647008`، يُحذف بنهاية الاختبار، وتنظيف احتياطي بـ `global-teardown` بمفتاح الخدمة من `.env.local`؛ الطلب يُلغى فيرجع المخزون ويبقى مجهّلاً). يرفض أي مشروع غير dev. ليس بـ CI (يحتاج dev ومفتاح الخدمة).
  - مرة واحدة: `pnpm --filter @mukhdar/customer exec playwright install webkit chromium`.
  - ضد النسخة المنشورة: `E2E_BASE_URL=https://mukhdar-app.pages.dev pnpm --filter @mukhdar/customer test:e2e`.
  - محلياً: `pnpm --filter @mukhdar/customer test:e2e` (يبني `dist` بـ `export:web` ويخدمه على `127.0.0.1:3000`، الأصل المسموح بـ `ALLOWED_ORIGINS` على dev؛ أوقف `admin dev` أولاً؛ `E2E_SKIP_BUILD=1` لاستعمال `dist` الحالي). كل تشغيل كامل يستهلك تسجيلين من حد `signup` (20/ساعة لكل IP).
- وحدات أصلية أُضيفت بعد آخر development build (مثل `expo-network`، مراجعة S4) تحتاج بناء dev client جديداً؛ Expo Go يتضمنها.

## 14) التسجيل: Edge Function `signup` (ADR 0001، تحديث 2026-11-15)

التسجيل العام بـ GoTrue **مطفأ**؛ الحساب الجديد يُنشأ فقط من هذه الدالة (`auth.admin.createUser`). تفحص الرقم والـ PIN بالخادم (نفس `packages/shared`)، وحدود المعدل: **20/ساعة لكل IP، 5/ساعة لكل رقم** (`private.signup_rate_limits`). لا تُرجع جلسة: التطبيق يدخل بعدها بـ `signInWithPassword`. لا أسرار إضافية.

### النشر (لكل بيئة، بموافقة صاحب المشروع)، بالترتيب
```bash
pnpm sb db push --remote --yes          # migration 20261117000001
pnpm sb functions deploy signup --remote=<ref> --use-api --no-verify-jwt --yes
pnpm it:signup                                     # التطوير فقط: يجب أن تنجح كل الفحوص
```
ثم من اللوحة: Authentication ← Sign In / Providers ← **Allow new users to sign up: OFF** (§6 خطوة 3)، ثم:
```bash
pnpm it:signup -- --signup-disabled                # signUp العام وOTP لرقم جديد مرفوضان ولا ينشئان حساباً
```
- النشر يرفع `packages/shared/src/pin.ts` و`phone.ts` مع الدالة (`import_map = supabase/functions/deno.json` بـ `config.toml`). تغيير قواعد الـ PIN = إعادة نشر `signup`.
- **الإنتاج:** نفس الترتيب **قبل** إصدار أي نسخة من التطبيقات (T24)؛ لا يوجد `it:signup` على الإنتاج (يرفض غير التطوير)، فافحص يدوياً: حساب تجريبي من التطبيق، ثم احذفه.

### اختبار التكامل (`pnpm it:signup`، مشروع التطوير فقط)
يستدعي الدالة المنشورة بالمفتاح المنشور (مثل التطبيق): إنشاء حساب ← دخول بالرمز، رمز خاطئ، رقم مسجل (409)، رمز سهل ورمز من الرقم (400)، رقم غير صالح، ترويسات IP مزوّرة (لا تُستعمل)، 6 محاولات لرقم واحد ← 429. أرقام بالبادئة `9647006`، ويحذف كل حساب أنشأه وصفوف الحدود التي بدأت أثناءه حتى عند الفشل. يحتاج `.env.local` (`SUPABASE_DB_PASSWORD`، `SUPABASE_SERVICE_ROLE_KEY`) و`apps/customer/.env`. ليس بـ CI. **كل تشغيل يستهلك ~12 من حد الـ IP (20/ساعة)**؛ الصفوف تُحذف بنهايته.

### المراقبة
```sql
-- أكثر المفاتيح محاولات بالساعة الحالية (مجزأة؛ لا يظهر IP ولا رقم)
select bucket, hits, window_start from private.signup_rate_limits
 where window_start > now() - interval '1 hour' order by hits desc limit 20;
```
سجلات الدالة: Dashboard ← Edge Functions ← signup ← Logs (`signup done`، أو رسالة الخطأ فقط؛ الـ PIN لا يُسجَّل أبداً).
- **زبون حقيقي محجوب بالخطأ** (CGNAT): ينتهي الحجب تلقائياً بعد ساعة. لفكّه فوراً لرقم معيّن:
  `delete from private.signup_rate_limits where bucket = 'phone' and key_hash = encode(sha256(convert_to('9647XXXXXXXXX', 'UTF8')), 'hex');`
- كثرة 429 من IP واحد لزبائن حقيقيين ← قرار برفع حد الـ IP (migration جديدة)، لا بإلغاء الحد.

### الحالة على mukhdar-dev (2026-11-15)
الـ migration مطبّق والدالة منشورة (`verify_jwt = false`). `pnpm it:signup`: 14/14، بلا بقايا؛ فُحص أن مفتاح الـ IP هو IP العميل الحقيقي (لا IP مشترك ولا ترويسة مزوّرة). **Allow new users to sign up: OFF** (أطفأه صاحب المشروع 2026-11-15). `pnpm it:signup -- --signup-disabled`: 6/6 (`signUp` العام وOTP لرقم جديد ← 422 `signup_disabled` بلا حساب؛ الدالة تنشئ حساباً ويدخل به).

## 15) لوحة الأدمن (T16)
**التشغيل محلياً (ضد mukhdar-dev):**
1. انسخ `apps/admin/.env.example` إلى `apps/admin/.env.local` وضع `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (نفس قيم `EXPO_PUBLIC_*` بتطبيق الزبون). مفتاح خادم (`service_role` / `sb_secret_`) يوقف اللوحة.
2. `pnpm install` ثم `pnpm --filter @mukhdar/admin dev` ← http://localhost:3000.
3. الدخول بحسابات العرض (تطوير فقط) والرمز `DEMO_PIN` = `482915` (§6): أدمن `07000000001`، موظف `07000000002`، ثم رمز تطبيق المصادقة (§6، T23). (سائق `07000000011` وزبون `07000000101` يرون "غير مصرح".)

**الاختبارات:** `pnpm --filter @mukhdar/admin test` (وحدة)، و`pnpm --filter @mukhdar/admin exec playwright install chromium` مرة واحدة ثم `pnpm --filter @mukhdar/admin test:e2e` (يبني اللوحة ويشغّلها على المنفذ 3100، يدخل بحسابات العرض؛ محلياً ضد المشروع بـ `.env.local`). بـ CI: job `admin-e2e` ضد Supabase محلي + `seed:demo`. حد Auth لكل IP (30/5 دقائق): التشغيل الكامل يدخل ~8 مرات.

**النشر لاحقاً (Vercel، يحتاج موافقة صاحب المشروع):**
- حساب Vercel (الخطة المجانية تكفي للبداية) وربط مستودع GitHub؛ Root Directory = `apps/admin`، Framework = Next.js، أمر التثبيت `pnpm install --frozen-lockfile` (pnpm من `packageManager`).
- متغيرات البيئة بـ Vercel (Preview ← mukhdar-dev، Production ← مشروع الإنتاج): `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` فقط. **لا `service_role` أبداً.**
- نطاق فرعي (مثلاً `admin.<domain>`) وإضافته لـ Supabase ← Authentication ← URL Configuration (Site URL / Redirect URLs) وإن لم تُستخدم روابط بريد.
- بعد النشر: رابط `/delete-account` بـ Google Play Console (Data safety ← Account deletion)، وروابط `/privacy` و`/terms` بـ `EXPO_PUBLIC_PRIVACY_URL` و`EXPO_PUBLIC_TERMS_URL` لتطبيق الزبون وبـ App Store Connect.
- قبل الإنتاج: استبدال بيانات المتجر بـ `apps/admin/src/content/legal.ts` و`IS_DRAFT = false` (SPEC-admin افتراض 15).

**T17:** اختبارات Playwright التي تنشئ وتعدّل طلبات تعمل فقط مع `E2E_ALLOW_WRITES=1` (CI ضد Supabase محلي مع Realtime). لا تضبطه ضد mukhdar-dev؛ بدونه تعمل اختبارات القراءة فقط.

**T18:** اختبارات الكتابة للكتالوج (قسم بصورة، منتج بصورة، مشتريات، هدر، تعطيل) ترفع صوراً، فـ job `admin-e2e` يشغّل `storage-api` أيضاً (لم يعد ضمن `-x`). نفس قاعدة `E2E_ALLOW_WRITES=1`.

**T20:** `reports.spec.ts`: القراءة (البطاقات = `report_summary`، تغيير المدى، تصدير CSV، رفض الموظف بقاعدة البيانات) تعمل ضد mukhdar-dev؛ اختبار هدر 7 أنصاف كيلو و3 باقات (ينشئ منتجين ثم يعطّلهما) فقط مع `E2E_ALLOW_WRITES=1`. سرعة التقارير على mukhdar-dev (بلا أثر، معاملة تُلغى): `node scripts/report-perf.mjs --remote --orders=50000`.

**T19:** اختبارات الكتابة للإعدادات والموظفين والعناوين (حفظ الإعدادات، ترقية، تصفير رمز، إنشاء سائق، عمارات بالجملة) تستدعي `admin-reset-pin` و`admin-create-user`، فـ job `admin-e2e` يشغّل `edge-runtime` أيضاً (لم يعد ضمن `-x`). نفس قاعدة `E2E_ALLOW_WRITES=1`. تصفير الرمز يستعمل زبون العرض `07000000119` ويرجعه لـ `DEMO_PIN` بنهاية الاختبار.

## 16) الإعدادات والموظفون: `admin-reset-pin` و`admin-create-user` (T19)
### النشر (لكل بيئة، بموافقة صاحب المشروع)، بالترتيب
```sh
pnpm sb db push --remote --yes          # migration 20261122000001 (update_app_settings، pin_resets، user_creations، add_buildings)
pnpm sb functions deploy admin-reset-pin --remote=<ref> --use-api --no-verify-jwt --yes     # T23 F H2: التحقق بالدالة
pnpm sb functions deploy admin-create-user --remote=<ref> --use-api --no-verify-jwt --yes   # T23 F H2: التحقق بالدالة
```
`SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` تحقنهما Supabase. **سر واحد (T23 H1):** `ALLOWED_ORIGINS` = أصول اللوحة المسموحة لـ CORS، مفصولة بفواصل، **بلا `*`** وبلا `/` أخيرة. Supabase المستضاف لا يضيف CORS للدوال، فالدالة ترد على الـ preflight بنفسها (`_shared/cors.ts`)؛ بدون السر لا يستطيع أي متصفح استدعاءها (الـ preflight ← 403):
```sh
pnpm sb secrets set ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000 --project-ref <ref>   # التطوير
pnpm sb secrets set ALLOWED_ORIGINS=https://admin.<domain> --project-ref <prod-ref>                    # الإنتاج (§17)
```
اللوحة تستدعي الدالتين بجلسة الأدمن (`functions.invoke`)، **بجلسة aal2** (T23 C1؛ وإلا `MFA_REQUIRED` 403). فحص سريع بعد النشر: `curl -i -X OPTIONS -H "Origin: <أصل اللوحة>" -H "Access-Control-Request-Method: POST" https://<ref>.supabase.co/functions/v1/admin-reset-pin` ← 204 و`access-control-allow-origin: <أصل اللوحة>`؛ وبأصل آخر ← 403 بلا الترويسة.

### اختبار التكامل (`pnpm it:admin-users`، مشروع التطوير فقط)
ينشئ أدمن وزبوناً مؤقتين (البادئة `9647007`) ويختبر الدالتين المنشورتين: (T23) الـ preflight من `http://localhost:3000` (أو `IT_PANEL_ORIGIN`) ← 2xx بالأصل نفسه، وأصل غريب ← بلا ترويسة؛ الأدمن بالـ PIN وحده ← `MFA_REQUIRED`، ثم يسجّل TOTP ويرتفع لـ aal2؛ الرفض (401/403/`ADMIN_ACCOUNT`/`PIN_INVALID`)، بعد التصفير يفشل الرمز القديم وينجح الجديد ويسقط رمز التحديث القديم، وسائق جديد يدخل برمزه المؤقت ويظهر بـ `list_drivers`، والرقم المكرر ← `PHONE_TAKEN`. يحذف كل الحسابات وسطور `pin_resets`/`user_creations` التي أنشأها حتى عند الفشل.

### التشغيل
- **نسيان الرمز (بشروط §7 الخطوة 4: نفس الرقم، سؤالان للزبون عن آخر طلب، مكالمة للموظف والسائق، ولا أدمن):** الشخص يراسل واتساب المتجر **من نفس الرقم المسجّل** ← الأدمن: الموظفون والسواق ← بحث بالرقم ← "تصفير الرمز" ← رمز عشوائي ← يظهر مرة واحدة ← "إرسال بالواتساب". التصفير يطلّعه من كل الأجهزة (رمز الوصول الحالي يبقى ≤ ساعة).
- **رمز أدمن:** لا يُصفَّر من اللوحة (`ADMIN_ACCOUNT`): صاحبه يغيّره من "تغيير الرمز"، أو صاحب المشروع بسكربت الطوارئ `pnpm admin:break-glass-reset` (§7).
- **الحد:** 20 محاولة تصفير و20 محاولة إنشاء بالساعة لكل أدمن؛ **كل محاولة تصل لمرحلة التغيير تُحسب**، ومنها الفاشلة مثل `PHONE_TAKEN` (من `admin_function_hits`، تُحذف بعد يوم)؛ ما يُرفض قبلها (`INVALID_REQUEST`، `USER_NOT_FOUND`، `ADMIN_ACCOUNT`، `PIN_INVALID`) لا يغيّر شيئاً ولا يُحسب. إن وصل أدمن شرعي للحد فانتظر ساعة. سجل التدقيق: `select * from public.pin_resets order by created_at desc` (بلا الرمز).

- **بعد أي ترقية لـ Supabase Auth (GoTrue):** شغّل `pnpm it:admin-users` على dev. الفحص الذي يثبت أن **الدخول بالرمز المؤقت لا يمسح `must_change_pin`** هو المرجع: الـ trigger يمسح العلامة عند أي تغيير لـ `encrypted_password`، فلو رفع إصدار جديد كلفة الـ hash عند الدخول لمُسحت العلامة بأول دخول (مراجعة AB، L6).
- **`RESET_INCOMPLETE` بلوحة الأدمن:** الرمز لم يُرسَل لأحد ولا تُرسله: أعد "ضبط الرمز" (الحقل يُمسح تلقائياً). السبب عادةً انقطاع لحظي بقاعدة البيانات.

### الحالة على mukhdar-dev (2026-11-16)
migration `20261122000001` مطبّقة، والدالتان منشورتان (`verify_jwt = true`)، و`pnpm it:admin-users` نجح (19 فحصاً) والحسابات المؤقتة حُذفت.

**مراجعة T16-T19 جلسة A:** migration `20261123000001` مطبّقة. الدالتان **بلا إعادة نشر**: علامة الرمز المؤقت تُضبط داخل `finish_user_creation` و`record_pin_reset` اللتين تستدعيانهما أصلاً. `pnpm it:admin-users` (28 فحصاً) يثبت على Supabase Auth الحقيقي: الدخول بالرمز المؤقت لا يمسح العلامة، والطلب يُرفض `PIN_CHANGE_REQUIRED`، و`updateUser` يمسحها، والسائق الجديد مرفوض حتى يغيّر رمزه.

**مراجعة T16-T19 جلسة B:** migration `20261124000001` مطبّقة، والدالتان `admin-create-user` و`admin-reset-pin` **أُعيد نشرهما على mukhdar-dev فقط** (`verify_jwt = true`؛ أدمن برمز مؤقت مرفوض، وحد المعدل يعدّ المحاولات، وسجل بلا الرمز). `pnpm it:admin-users` (35 فحصاً) و`pnpm it:break-glass` (20 فحصاً) نجحا على dev، وحُذفت حساباتهما المؤقتة. **قبل الإنتاج:** تطبيق `20261124000001` ثم نشر الدالتين بالموافقة (الترتيب مهم: الدالتان الجديدتان تستدعيان `admin_rate_hit`).

**مراجعة الإصلاحات AB، جلسة C (2026-11-16):** migrations `20261125000001` و`20261125000002` (تدقيق إعادة تسمية/إخفاء القطاع والوحدة والعمارة بـ `admin_audit`، `action = 'address'`) **مطبّقتان على mukhdar-dev فقط** (فُحصت أولاً بـ `db:test:remote --prelude` داخل معاملة ملغاة، ثم `db push`)، و`admin-reset-pin` **أُعيد نشرها على mukhdar-dev فقط** (`verify_jwt = true`، رد 401 بلا JWT). لم يُنشر غيرها ولم يُغيَّر شيء سحابي آخر. `pnpm db:test:remote`: 23 ملفاً و872 تأكيداً. حالة CI مرجع لاختبار التزامن (`db:concurrency`، حالة تخفيض السائق أثناء القبول) ولاختبارات اللوحة.

**T23 جلسة F (2026-11-17):** الدوال الخمس أُعيد نشرها على mukhdar-dev فقط بـ `--no-verify-jwt` (`verify_jwt: false` مؤكد من قائمة الدوال)، وتقرأ المفاتيح الجديدة: سجل الدوال يُظهر `keys {"secret":"new","publishable":"new"}`. `pnpm it:admin-users` و`it:signup` و`it:delete-account` و`it:break-glass` نجحت كلها على dev بعد النشر. المفاتيح القديمة على dev **لم تُطفأ** (لم يلزم للاختبار: الدوال تستعمل الجديدة أصلاً، والتطبيقات والسكربتات بمفاتيح `sb_publishable_`/`sb_secret_`).

### اختبارات الكتابة بالواجهة (T7)
اختبارات Playwright التي **تكتب** (حفظ الإعدادات، ترقية، تصفير رمز، إنشاء سائق، عمارات، طلبات) تعمل **بـ CI فقط** (`E2E_ALLOW_WRITES=1` على Supabase محلي مؤقت)؛ محلياً ضد mukhdar-dev تعمل القراءة وما يُرفض بلا كتابة، وهذا مقصود (لا نكتب ببيانات التطوير من اختبارات). حالة CI هي المرجع: لا دمج بلا نجاح وظيفة `admin-e2e`.

### التشغيل بعد الجلسة A
- **تعطيل سائق:** إن رُفض بـ "السائق عنده طلبات لم تنتهِ: … الطلبات: #12" ← افتح كل طلب ← "نقل الطلب لسائق آخر" (يعمل حتى والطلب بالطريق) ← ثم عطّله.
- **طلب بالطريق والبضاعة ضاعت/تلفت:** إلغاء (أدمن) مع خانة "البضاعة طلعت مع السائق" ← تُسجَّل هدراً بكلفة الطلب.
- **سجل التدقيق:** (يشمل منذ جلسة C تغيير اسم/رقم/تفعيل القطاع والوحدة والعمارة: `action = 'address'`، الجدول والمعرّف داخل before/after) `select * from public.admin_audit order by created_at desc limit 50;` (من، الإجراء، الهدف، قبل ← بعد).

## 17) إطلاق الإنتاج: ترتيب الـ migrations والدوال (مراجعات الجلسات A وB وC وD، حتى T26، وإصلاحات T23 جلسات E1 وE2 وF، 2026-11-17)

> مشروع الإنتاج **لم يُنشأ بعد** (§1)، فلا توجد "حالة إنتاج سابقة": كل الـ migrations أدناه تُطبَّق عليه، **بهذا الترتيب** (الترتيب الزمني لأسماء الملفات؛ `db push` يطبّقها هكذا). كل خطوة سحابية **بموافقة صاحب المشروع**. إن وُجد مشروع إنتاج جزئياً لاحقاً: `pnpm sb migration list --remote` أولاً، ثم طبّق الناقص فقط بنفس الترتيب.
> إصلاحات المراجعة `docs/reviews/review-fixes-AB.md` (جلسة C: migration `20261125000001` لـ H1/M1 والبنود Low، وإعادة نشر `admin-reset-pin`) مدرجة أدناه (الصفان 24 و25).

### 1. الـ migrations بالترتيب (34 ملفاً)
| # | الملف |
|---|---|
| 1 | `20261110000001_init.sql` |
| 2 | `20261110000002_storage.sql` |
| 3 | `20261111000001_advisor_fixes.sql` |
| 4 | `20261111000002_review_fixes.sql` |
| 5 | `20261112000001_sequence_grants.sql` |
| 6 | `20261112000002_inactive_driver_orders.sql` |
| 7 | `20261112000003_push_dispatch.sql` |
| 8 | `20261112000004_delete_account.sql` |
| 9 | `20261114000001_address_wording.sql` |
| 10 | `20261115000001_order_status_ready.sql` |
| 11 | `20261115000002_ready_flow.sql` |
| 12 | `20261115000003_push_reliability.sql` |
| 13 | `20261115000004_hardening.sql` |
| 14 | `20261115000005_deletion_safety.sql` |
| 15 | `20261116000001_phone_pin_auth.sql` |
| 16 | `20261117000001_signup_rate_limit.sql` |
| 17 | `20261118000001_set_default_address.sql` |
| 18 | `20261119000001_revoke_user_sessions.sql` |
| 19 | `20261120000001_staff_delivery_fallback.sql` |
| 20 | `20261121000001_catalog_stock.sql` |
| 21 | `20261122000001_admin_settings_staff.sql` |
| 22 | `20261123000001_account_lifecycle.sql` |
| 23 | `20261124000001_review_session_b.sql` |
| 24 | `20261125000001_review_session_c.sql` |
| 25 | `20261125000002_address_audit.sql` |
| 26 | `20261126000001_reports.sql` (T20: التقارير + L4(أ). لا Edge Function تعتمد عليها؛ اللوحة تحتاجها لصفحة التقارير، فطبّقها قبل نشر اللوحة) |
| 27 | `20261127000001_dashboard.sql` (T25: `dashboard_today()` للأدمن والموظف، المال null للموظف من الدالة نفسها، وفهرس `orders(cancelled_at)` الجزئي. لا Edge Function تعتمد عليها؛ اللوحة تحتاجها للرئيسية، فطبّقها قبل نشر اللوحة) |
| 28 | `20261128000001_ratings.sql` (T26: `rate_order` مشدَّد، `ratings_summary` و`ratings_list`، `report_summary` يستعمل نفس حساب التقييمات، و`dashboard_today` يرجع `stuck_notifications` للأدمن. لا Edge Function تعتمد عليها؛ اللوحة تحتاجها لشاشة التقييمات، فطبّقها قبل نشر اللوحة. توقيع `rate_order` **لم يتغير** (`p_order_id, p_stars, p_comment` ← `void`)، لكن **سلوكه** تغيّر (أخطاء جديدة `COMMENT_TOO_LONG` و`PIN_CHANGE_REQUIRED` و`NOT_ALLOWED` للحساب المعطّل، وتعليق مقصوص) ولا يمس تطبيق الزبون) |
| 29 | `20261129000001_ratings_privacy.sql` (مراجعة C جلسة D، L2–L4: `rate_order` يزيل محارف bidi والعرض الصفري وC1 ويحوّل CR إلى LF؛ `ratings_list` يُرجع `customer_name = null` لزبون محذوف؛ حذف `ratings_created_idx`. لا Edge Function تعتمد عليها؛ توقيعات الدوال لم تتغير) |
| 30 | `20261130000001_security_t23.sql` (T23 جلسة E1: **C1** `current_user_role()` يطلب `aal2` للأدمن والموظف، `admin_reset_mfa` و`break_glass_reset_mfa`، `admin_audit.action` يقبل `mfa_reset`؛ **H2** `app_settings.max_line_qty` (20) و`max_order_lines` (30)، `place_order` يفرضهما (`QTY_LIMIT`، `TOO_MANY_ITEMS`)، `update_app_settings` يعدّلهما. **قبلها:** TOTP مفعّل بـ Auth (§6 الخطوة 8)، وإلا يُقفل الأدمن عن اللوحة. لوحة الأدمن الحالية (صفحة `/mfa`) والدالتان الإداريتان تحتاجانها) |
| 31 | `20261201000001_security_t23_e2.sql` (T23 جلسة E2: **H2** `app_settings.new_account_max_active_orders` (افتراضي 1) وفحص `place_order` للحساب الجديد وإعادة فحص الحساب الفعّال، و`admin_cancel_customer_orders`؛ **M5** محو بيانات الزبون من طلباته عند حذف حسابه (trigger `BEFORE DELETE` + تنظيف الطلبات السابقة)؛ **M6** `orders_read` للموظف: المفتوح وآخر 7 أيام؛ **M7** `private.panel_sessions` و`touch_panel_session` وفحص الخمول 12 ساعة بـ `current_user_role()`؛ **L2** حد 5 رموز إشعار و`purge_push_history` يحذف رموزاً لم تُشاهد 60 يوماً؛ **L3** `private.clean_user_text` وحد 20 عنواناً. **بعد `20261130000001`، وقبل نشر `admin-reset-pin` و`admin-create-user` بنسختيهما الحاليتين** (تستدعيان `touch_panel_session`) |
| 32 | `20261202000001_security_f.sql` (T23 جلسة F: **H1** الإشعارات للأدمن/الموظف بجلسة aal2 فقط (`push_tokens.session_id`، `register_push_token` يطلب aal2، `claim_push_notifications` definer يفحص الجلسة، حذف رموز الأدمن/الموظف القديمة)؛ **M1** التقييمات للموظف آخر 7 أيام؛ **M2** `pin_reset_at` وحذف عامل TOTP المسجَّل أثناء الرمز المؤقت، و`set_user_role` يطلب إعادة ضبط الرمز قبل الترقية (`PIN_RESET_REQUIRED`)؛ **M3** `max_order_iqd` (200000) و`new_account_max_order_iqd` (50000) و`ORDER_TOO_LARGE`/`NEW_ACCOUNT_ORDER_LIMIT`؛ **M4** `panel_session_alive()`؛ **L3** جدول `private.deployment` (بلا صف)؛ **L4/L8** الإيقاف لا يلغي `out_for_delivery` وقفل بترتيب ثابت؛ **L5** تنظيف سبب الإلغاء وتجهيل أوسع؛ **L6** حذف جلسات Auth الخاملة؛ **L7** الموظف لا يحذف حسابه من التطبيق. **بعد `20261201000001`.** لا Edge Function تعتمد عليها؛ اللوحة الحالية تستدعي `panel_session_alive` (فطبّقها قبل نشر اللوحة)، وتطبيق الزبون الحالي يعرض الرسالتين الجديدتين (القديم يعرض رسالة عامة) |
| 33 | `20261203000001_definer_triggers.sql` (إصلاح 2026-11-18، بلاغ iOS Safari: `private.tg_clean_profile_name` و`private.tg_clean_address_text` صارتا SECURITY DEFINER بـ `search_path = ''` وEXECUTE مسحوب من كل الأدوار؛ بدونها يفشل حفظ اسم الزبون وإضافة/تعديل العنوان بـ 42501. **بعد `20261202000001`.** لا Edge Function تعتمد عليها؛ التطبيقات بلا تغيير مطلوب (الإصدار الجديد يعرض رسالة صلاحية محددة)) |
| 34 | `20261204000001_address_floor.sql` (قرار المالك 2026-11-18: `addresses.floor` 0..20 (0 = الأرضي)، إلزامي لعنوان جديد من التطبيق (`FLOOR_REQUIRED`) ولا يُمسح، وtrigger يضيف `floor` للقطة الطلب. **بعد `20261203000001`** (تعيد تعريف `tg_clean_address_text` كـ definer). لا Edge Function تعتمد عليها. **تطبيق الزبون:** الإصدار الجديد يرسل الطابق؛ إصدار أقدم يضيف عنواناً جديداً ← `FLOOR_REQUIRED` (رسالة عامة)، فانشر الـ migration مع إصدار التطبيق أو بعده مباشرة؛ اللوحة القديمة تعمل وتتجاهل الطابق) |

**قاعدة إلزامية (5، T23 F):** طبّق `20261202000001` قبل نشر اللوحة بإصدار جلسة F (تستدعي `panel_session_alive`؛ بدونها كل فحص يفشل فتُخرج اللوحة المستخدم إلى `/login?reason=idle`). **لا تُدرج صف `private.deployment` على الإنتاج أبداً** (العلامة للتطوير والمحلي فقط؛ غيابها هو ما يمنع سكربتات البيانات التجريبية). الـ migration تحذف رموز إشعار الأدمن والموظف، فيعيد كل منهم التسجيل بأول دخول aal2 (تلقائي).

**قاعدة إلزامية (4، T23 E2):** طبّق `20261201000001` **قبل** إعادة نشر `admin-reset-pin` و`admin-create-user` (النسخة الجديدة تستدعي `touch_panel_session` وتفشل مغلقة `500 INTERNAL` بدونها)، وقبل نشر اللوحة (`proxy.ts` يستدعيها؛ غيابها لا يكسر الدخول لكنه يعطّل فحص الخمول). **ملاحظة تطبيق:** الميزة تحتاج لوحة (CSP، `IdleGuard`، زر الإلغاء الجماعي) وتطبيق زبون (نص حد الطلب الواحد) بإصدار بعد هذا الـ commit؛ الـ migration نفسها متوافقة مع الإصدار القديم (ترفض الزائد برمز يفهمه).

**قاعدة إلزامية (3، T23):** فعّل **TOTP** بـ Auth (§6 الخطوة 8) **قبل** `20261130000001`، واضبط سر **`ALLOWED_ORIGINS`** (§16) **قبل** نشر `admin-reset-pin` و`admin-create-user` بنسختهما الحالية (بلا السر يرفض الـ preflight كل متصفح). الدالتان تطلبان aal2 بنفسهما، فلا تعتمدان على الـ migration، لكن اللوحة الحالية تفترضها.

**قاعدة إلزامية (2):** طبّق migration **`20261125000001`** قبل نشر **`admin-reset-pin`** بنسخته الحالية (الجلسة C)؛ الدالة نفسها تعمل بدونها، لكن `record_pin_reset` الجديدة هي التي تحذف رموز الإشعارات (H1)، فلا يكتمل قطع الجهاز الضائع بغيرها. وهي تحذف `admin_actions_last_hour` (غير مستعملة).

**قاعدة إلزامية:** طبّق migration **`20261124000001`** قبل نشر **`admin-create-user`** و**`admin-reset-pin`**. النسخة الحالية من الدالتين تستدعي `admin_rate_hit` و`record_pin_reset(..., p_kind)`، وهما غير موجودتين قبل هذه الـ migration: لو نُشرت الدالتان أولاً، فكل إنشاء حساب وكل إعادة ضبط رمز يفشل بـ 500.

قاعدة للتحقق قبل `20261124000001` (فقط إن كان بالإنتاج بيانات عناوين قبلها؛ على مشروع جديد فارغ لا حاجة): يجب أن يرجع 0، وإلا يفشل قيد العمارة 1..100:
```sql
select count(*) from public.buildings where number !~ '^([1-9][0-9]?|100)$';
```

### 2. الترتيب الكامل
1. أنشئ المشروع بمنطقة **`eu-central-1`** (§1) **باسم `mukhdar-prod`**. ثم، بنفس الـ commit، ضع الـ ref الحقيقي مكان الـ placeholder في `PROD_PROJECT_REFS` (`scripts/lib/projects.mjs`؛ **ولا تضفه أبداً لـ `DEV_PROJECT_REFS`**: أي ref بالقائمتين يوقف كل السكربتات) (إلى ذلك الحين يرفض `pnpm sb` كل شيء على الإنتاج). **لا تربط الإنتاج بنسخة العمل اليومية** (المربوطة بـ mukhdar-dev): أنشئ نسخة منفصلة للإنتاج، واربطها هناك فقط:
   ```bash
   git worktree add ../mukhdar-prod main      # أو clone منفصل
   cd ../mukhdar-prod && pnpm install
   pnpm sb link --project-ref <prod-ref>      # يعرض لافتة PRODUCTION
   ```
   كل أوامر الإنتاج بالخطوات التالية تُشغَّل من `../mukhdar-prod` فقط، بـ `MUKHDAR_TARGET=prod pnpm sb …`، وتكتب الـ ref عند السؤال. لا حاجة لـ "إعادة ربط التطوير": نسخة التطوير لم تُمس. (سكربتات `seed:*` و`db:concurrency` و`it:*` ترفض أي مشروع غير mukhdar-dev، **وترفض ref الإنتاج دائماً حتى لو أُضيف خطأً لقائمة التطوير** (T23 H3، `scripts/seed-guard.test.mjs`)، وهذا مقصود. اختبار الحمل على الإنتاج له مسار صريح منفصل: §17.4.)
2. إعدادات Auth من اللوحة **أولاً**: §6 الخطوات 1، 2، 4، 5، 6 (Email: Disabled)، 7، و**8 (TOTP: Enabled) قبل أي migration** (`20261130000001` تقفل الأدمن عن اللوحة بلا TOTP). **الخطوة 3 (إيقاف التسجيل العام) لاحقاً**، بعد نشر `signup`.
3. `pnpm sb db push --remote --dry-run` ← يجب أن يعرض الـ 34 ملفاً بالترتيب أعلاه ← `MUKHDAR_TARGET=prod pnpm sb db push --remote` (يسأل الحارس عن الـ ref ثم الـ CLI عن التأكيد). **لا** `insert into private.deployment` على الإنتاج (علامة التطوير فقط، L3؛ تُضاف على mukhdar-dev مرة واحدة يدوياً وبـ `seed.sql` محلياً).
4. الدوال، بالترتيب (كلها بعد الخطوة 3، فالقواعد أعلاه محققة تلقائياً؛ **كلها `--no-verify-jwt`** منذ T23 F H2: التحقق من المستخدم داخل الدالة):
   ```bash
   pnpm sb functions deploy push-dispatch     --remote=<prod-ref> --use-api --no-verify-jwt
   pnpm sb functions deploy delete-account    --remote=<prod-ref> --use-api --no-verify-jwt
   pnpm sb functions deploy signup            --remote=<prod-ref> --use-api --no-verify-jwt
   MUKHDAR_TARGET=prod pnpm sb secrets set ALLOWED_ORIGINS=https://admin.<domain> --project-ref <prod-ref>   # T23 H1: نطاق لوحة الإنتاج فقط، قبل الدالتين
   pnpm sb functions deploy admin-reset-pin   --remote=<prod-ref> --use-api --no-verify-jwt   # بعد 20261125000001
   pnpm sb functions deploy admin-create-user --remote=<prod-ref> --use-api --no-verify-jwt   # بعد 20261124000001
   ```
   ثم `push_dispatch_url` بـ Vault (§11).
5. §6 الخطوة 3: **Allow new users to sign up: OFF**، وفحص يدوي: حساب تجريبي من التطبيق ثم احذفه (§14).
6. البيانات الأساسية (المدينة، القطاعات، الوحدات، العمارات 1..100): من `supabase/seed.sql` بقرار المالك (§10؛ الملف يضيف أيضاً كتالوجاً تجريبياً بأسعار، فيُراجع قبل تشغيله على الإنتاج). **لا** `seed:demo` ولا `DEMO_PIN` على الإنتاج.
7. أول أدمن (§7 الخطوتان 1 و2) برقم صاحب المشروع ورمز لا يعرفه غيره، ثم أول دخول للوحة يسجّل تطبيق المصادقة (`/mfa`). **لا** السر التجريبي على الإنتاج أبداً.
8. اللوحة على Vercel (Production ← مشروع الإنتاج): `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` فقط (§15).

### 3. `.env.local` بجذر المشروع (جهاز صاحب المشروع فقط، مُتجاهل بـ git)
سكربت الطوارئ `pnpm admin:break-glass-reset` (§7) **يرفض العمل** بدون هذا السطر، ويطبع المشروع الذي يشير له قبل أي سؤال:
```
SUPABASE_URL=https://<prod-ref>.supabase.co
```
**(L7، T23) لا تحفظ مفتاح الإنتاج السري بـ `.env.local` أبداً:** مرّره بمتغير بيئة وقت التشغيل من مدير كلمات السر (قائمة §17.5). مع `SUPABASE_SERVICE_ROLE_KEY=<مفتاح service_role لنفس المشروع>` (القالب `.env.example`). `.env.local` الحالي يشير لـ mukhdar-dev؛ للإنتاج مرّر القيمتين بالبيئة وقت التشغيل، أو احتفظ بنسخة منفصلة، ولا تخلط رابط مشروع بمفتاح مشروع آخر (السكربت يفشل حينها بلا تغيير). المفتاح لا يُوضع بأي مكان آخر.

### 4. قائمة فحص قبل الإطلاق (go-live) — T22 وزمن الاستجابة
لازمة **قبل فتح التطبيق للزبائن** (T22 اعتُبرت ✅ بالصحة فقط؛ الزمن لم يُقَس على بيئة حقيقية):
- [ ] **اختيار منطقة الإنتاج الأقرب للعراق:** قِس زمن الذهاب والإياب (RTT) من بغداد إلى المناطق المرشحة لـ Supabase (مثلاً Frankfurt مقابل Singapore وأي منطقة أقرب متاحة) واختر الأقل. إن اختلف الناتج عن `eu-central-1` المذكورة بالخطوة 2.1 فحدّث RUNBOOK §1 وهذه الوثيقة بنفس الـ commit، **قبل** إنشاء المشروع (المنطقة لا تتغير بعدها).
- [ ] **اختبار الحمل قبل فتح الإنتاج للزبائن** بنفس العتبات. **الأفضل** على مشروع staging بنفس خطة الإنتاج ومنطقته (يُضاف ref الـ staging لـ `DEV_PROJECT_REFS` كأي مشروع تطوير). على الإنتاج نفسه فقط إن لم يوجد staging، **وبالمسار الصريح فقط** (T23 H3): من نسخة الإنتاج المنفصلة (§17.2 الخطوة 1)، `pnpm load:run -- --target=prod` (يرفض إن لم يكن المشروع المربوط هو ref الإنتاج المسجّل بـ `PROD_PROJECT_REFS`، ويطلب طرفية حقيقية **وكتابة الـ ref حرفياً**)، ثم `pnpm load:cleanup -- --target=prod` والتحقق من **صفر بقايا** (حسابات وطلبات وحركات مخزون الحمل). **لا تضف ref الإنتاج أبداً لـ `DEV_PROJECT_REFS`** (ولا لأي قائمة سماح للتطوير): `seed:demo`/`seed:reset` و`it:*` ترفضه دائماً، وأي ref بالقائمتين يوقف كل السكربتات. الحمل يسجّل TOTP لأدمن/موظف الحمل المؤقتين بنفسه (Auth API) ويحذفهما بالتنظيف.
- [ ] **`ALLOWED_ORIGINS` على الإنتاج = نطاق لوحة الإنتاج فقط** (مثلاً `https://admin.<domain>`، بلا `localhost` ولا `*`)، قبل نشر `admin-reset-pin` و`admin-create-user` (§16). تحقق: `curl -i -X OPTIONS -H "Origin: https://admin.<domain>" -H "Access-Control-Request-Method: POST" https://<prod-ref>.supabase.co/functions/v1/admin-reset-pin` ← 204 بالأصل نفسه، و`Origin: http://localhost:3000` ← 403 بلا ترويسة.
- [ ] **TOTP مفعّل بـ Auth** (§6 الخطوة 8) وأول أدمن سجّل تطبيق المصادقة؛ واختبار سريع: دخول بالـ PIN وحده ← `/mfa`، ولا بيانات قبل الرمز.
- [ ] **مراقبة كلفة استعلام Realtime الدوري على قاعدة الإنتاج:** كان أكبر مستهلك لقاعدة البيانات في T22 ([load-test-T22.md](reviews/load-test-T22.md)).
- [ ] **اختبار `BELOW_MIN_ORDER` تحت الحمل على الإنتاج** إن كان للطلب حد أدنى مضبوطاً.

### 5. قائمة إعدادات الإنتاج (T23، مدموجة من `docs/reviews/security-T23.md`)
كلها **يدوية من اللوحات** بموافقة صاحب المشروع (لا يغيّرها Claude). علّم كل بند بتاريخه عند التنفيذ.

**مشروع Supabase (`mukhdar-prod`، `eu-central-1` أو الأقرب بالقياس، خطة Pro)**
- [ ] المنظمة: كل الأعضاء بمصادقة ثنائية (2FA)، وفعّل "Require MFA"؛ أقل عدد مالكين (المالك + شخص احتياطي).
- [ ] Spend cap وتنبيهات الاستهلاك مفعّلة، وبريد المالك.
- [ ] **Auth ← Providers:** Phone **مفعّل** وتأكيد الهاتف **معطّل**؛ Email **معطّل**؛ الدخول المجهول **معطّل**؛ كل OAuth معطّل؛ الربط اليدوي معطّل؛ **بلا Test OTPs**.
- [ ] **Auth ← Hooks:** Send SMS hook = دالة Postgres `private.hook_send_sms_reject`.
- [ ] **Auth ← Allow new users to sign up: OFF** (بعد نشر `signup` وفحصه، §14).
- [ ] **Auth ← Passwords:** أقل طول 6، بلا محارف مطلوبة، و**Leaked password protection معطّل** (يرفض كل الـ PINs).
- [ ] **Auth ← MFA:** TOTP **مفعّل** (C1). Phone MFA معطّل (مدفوع، SMS).
- [ ] **Auth ← Rate limits:** التسجيل والدخول 30 / 5 دقائق لكل IP؛ تجديد الرمز 150 / 5 دقائق؛ التحقق 30. **دوّن القيم يوم الضبط** (خط أساس مراقبة M1، §6).
- [ ] **Auth ← Sessions/JWT:** عمر JWT **3600 ثانية** (قرار المالك: يبقى؛ المخاطرة L1 مقبولة، ADR 0003)؛ دوران refresh-token مفعّل وفترة إعادة الاستخدام 10 ثوان. **خمول جلسة اللوحة (12 ساعة) يفرضه التطبيق بقاعدة البيانات (M7)** فلا تفعّل Time-box ولا Inactivity timeout هنا (تؤثر على تطبيق الزبون والسائق أيضاً).
- [ ] **Auth ← URL configuration:** Site URL = نطاق اللوحة؛ قائمة Redirect المسموحة = نطاق اللوحة فقط.
- [ ] **CAPTCHA:** معطّل عند الإطلاق؛ Turnstile فقط عند علامة التشغيل (§6 مراقبة التخمين).
- [ ] **API keys ومفاتيح توقيع JWT (T23 F H2) — بهذا الترتيب بالضبط:**
  1. **انشر الدوال الخمس أولاً** بالنسخة الحالية (§17.2 الخطوة 4، كلها `--no-verify-jwt`). تقرأ المفتاح الجديد (`SUPABASE_SECRET_KEYS`) وترجع للقديم، وتتحقق من JWT المستخدم بنفسها (`auth.getUser`)، فلا تعتمد على بوابة `verify_jwt` التي لا تفهم المفاتيح الجديدة. تأكد من قائمة الدوال أن `verify_jwt = false` للخمس.
  2. أنشئ مفتاحي publishable وsecret الجديدين (Settings ← API Keys)، ومفتاح secret ثانياً باسم `break-glass` (L7، §7). ضع `sb_publishable_…` فقط بـ Vercel وEAS (§17.2 الخطوة 8، والتطبيقات)، وانشر اللوحة والتطبيقات بها.
  3. فعّل **مفاتيح توقيع JWT غير المتماثلة** (JWT Keys ← ES256) ودوّرها لتصير المستعملة. الرموز القديمة HS256 تبقى صالحة حتى تنتهي (≤ ساعة).
  4. **تحقق قبل الإطفاء:** سجل الدوال يُظهر `keys {"secret":"new",...}` (لا `legacy`)؛ دخول اللوحة بـ aal2 وإعادة ضبط رمز وإنشاء حساب ينجحان؛ تسجيل وحذف حساب تجريبي من التطبيق؛ إشعار يصل (push-dispatch بسر Vault، لا مفتاح بـ `pg_net`)؛ ولا 401 غير مفسّرة بسجل الدوال ولا بسجل Auth (Logs ← Auth).
  5. بعدها فقط **عطّل مفاتيح `anon`/`service_role` القديمة** (Settings ← API Keys ← Legacy). أعد فحص البند 4 فوراً؛ إن فشل شيء فأعد تفعيلها (الإطفاء قابل للتراجع من نفس الصفحة) وافحص السبب.
  على mukhdar-dev (2026-11-17): الخطوات 1–4 مُثبتة (المفاتيح الجديدة وES256 مستعملة)، والقديمة لم تُطفأ.
- [ ] **Data API:** المخططات المكشوفة `public` فقط (و`graphql_public` إن لزم؛ `pg_graphql` غير مثبّت)؛ max rows 1000.
- [ ] **Database:** SSL إجباري **مفعّل**؛ كلمة سر قوية بمدير كلمات سر فقط؛ قيود الشبكة لـ IP المالك إن كان ثابتاً (وإلا تبقى مفتوحة وكلمة السر هي الحارس).
- [ ] **Realtime (L4):** `public.orders` فقط بـ `supabase_realtime`؛ إن وُجد مفتاح "Allow public access" فعطّله **بعد اختباره على dev** (لوحة الأدمن وتطبيق الزبون والسائق تبقى تتصل بـ postgres_changes)، وإلا راقب استهلاك Realtime.
- [ ] **Storage:** سلة `product-images` عامة، 512 KB، `image/jpeg,image/webp,image/png` (تُنشأ بـ migration `20261110000002`؛ تحقق بالإعدادات).
- [ ] **Edge Functions:** `verify_jwt` = **false للخمس** (T23 F H2؛ التحقق داخل الدوال)؛ الأسرار: `ALLOWED_ORIGINS` (§16؛ **ليس** `ADMIN_ORIGINS`)، و`EXPO_ACCESS_TOKEN` اختيارياً؛ لا شيء غيرها. `push_dispatch_url` بـ Vault (§11).
- [ ] **Advisors:** `pnpm sb db advisors --remote` ← **34 تحذيراً** المعروفة بالضبط + 5 INFO `rls_enabled_no_policy` المقصودة (§5)، 0 أخطاء.
- [ ] **النسخ الاحتياطي:** Pro اليومي (7 أيام) مؤكد؛ **PITR**: قرار المالك (إضافة مدفوعة)؛ تجربة استعادة واحدة لمشروع مؤقت قبل الإطلاق (SPEC-backend §11).
- [ ] **السجلات/المراقبة:** استعلام محفوظ لـ `invalid_credentials` المتكررة لكل رقم وموجات 429 (M1، §6)؛ نظرة أسبوعية على `signup_rate_limits` و`pin_resets` و`admin_audit` (فيها `customer_lockdown`).

**Vercel (لوحة الأدمن)**
- [ ] أعضاء الفريق بمصادقة ثنائية؛ متغيرات Production = `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` للإنتاج فقط؛ Preview ← مشروع dev فقط.
- [ ] Deployment Protection على نسخ Preview.
- [ ] نطاق مخصص بـ HTTPS؛ وبعد النشر تحقق أن الترويسات ظاهرة بالموقع الحي: `curl -sI https://admin.<domain>/login` يجب أن يُظهر `Content-Security-Policy` (فيها `frame-ancestors 'none'` و`nonce-`) و`Strict-Transport-Security` و`X-Frame-Options: DENY` و`X-Content-Type-Options: nosniff` و`Referrer-Policy` و`Permissions-Policy` (T23 M3). لا تضع `PANEL_INSECURE_COOKIES` بالإنتاج أبداً.
- [ ] `legal.ts` معبّأ و`IS_DRAFT = false`؛ `/privacy` و`/delete-account` تطابق السلوك (M5: يبقى القطاع والوحدة فقط بالطلبات القديمة).

**التطبيقات والحسابات**
- [ ] بيئة EAS للإنتاج: رابط ومفتاح publishable للإنتاج؛ البناء يرفض مرجع dev (L8: يفشل `app.config.ts` عند `APP_ENV=production` مع مرجع dev، والتطبيق يعرض خطأ مانعاً).
- [ ] حسابات Expo وApple وGoogle بمصادقة ثنائية؛ حساب مراجعي Apple بدور `customer` فقط ورمزه الخاص (ليس `DEMO_PIN`).
- [ ] تطبيق السائق: قبل ربطه بالإنتاج افحص بناءه (المفتاح publishable فقط، الجلسة بتخزين آمن، مسار السائق بلا MFA)؛ سلّم المطوّر وصول الإنتاج بعدها فقط.
- [ ] حسابات الأدمن والموظفين على الإنتاج مسجَّلة بـ TOTP؛ ورقم الأدمن ليس رقم المتجر المنشور.
- [ ] لا `seed:demo` ولا `DEMO_PIN` ولا `DRIVER_DEMO_PIN` ولا حسابات حمل على الإنتاج؛ و`DEV_PROJECT_REFS` لا يحوي مرجع الإنتاج (H3).
- [ ] **مفتاح الإنتاج السري (L7):** لا يُحفظ بـ `.env.local` (الملف للتطوير). يُحفظ بمدير كلمات سر، ويُمرَّر بمتغير بيئة وقت تشغيل سكربت الطوارئ وحده (`SUPABASE_SERVICE_ROLE_KEY=… pnpm admin:break-glass-reset …`). بالإنتاج استعمل مفتاح `sb_secret_…` باسم `break-glass` وبدّله بعد كل استعمال؛ BitLocker على جهاز المالك.
- [ ] **GitHub (L10، يدوي، غير مفعّل بعد):** Dependabot alerts وsecurity updates (Settings ← Code security) ومصادقة ثنائية لحساب المالك. ثم شغّل `pnpm audit` قبل T24 (المعروف: moderate اثنان بأدوات البناء فقط).
- [ ] **L9:** إن وُجد خيار "Require current password when changing password" ينطبق على مستخدمي الهاتف بالإنتاج فعّله بعد اختباره على dev؛ وإلا المخاطرة مقبولة (ADR 0003).
