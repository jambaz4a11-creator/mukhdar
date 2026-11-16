# RUNBOOK: تشغيل وصيانة "المخضر"

> هذا الملف يُكمَّل مع المهام. قسم الطوارئ (توقف الإشعارات، امتلاء القاعدة، الاستعادة) يأتي بـ T24.

## 1) المشاريع والمناطق

| البيئة | اسم المشروع | ref | المنطقة | الخطة |
|---|---|---|---|---|
| تطوير | `mukhdar-dev` | `ghcohlrzvehtcettaaiu` | `ap-southeast-1` (سنغافورة) | مجانية |
| إنتاج | لم يُنشأ بعد | - | **يجب** `eu-central-1` (فرانكفورت) | Pro |

- **مشروع التطوير بسنغافورة** لأنه أُنشئ هناك مسبقاً. هذا مقبول للتطوير فقط.
- **مشروع الإنتاج يجب أن يُنشأ بمنطقة أوروبية: فرانكفورت (`eu-central-1`)**، لأنها أقرب للعراق وزمن الاستجابة منها أقل بكثير من سنغافورة. المنطقة لا تتغير بعد إنشاء المشروع، فانتبه لها وقت الإنشاء.
- المشاريع المجانية تتوقف بعد فترة عدم نشاط. إذا توقف `mukhdar-dev`، شغّله من اللوحة (Restore).

## 2) الأدوات (بدون Docker)

نعمل على المشروع السحابي مباشرة، ولا نشغّل Supabase محلياً (توفيراً للموارد على ويندوز).
الـ CLI مثبت كـ devDependency: `pnpm exec supabase ...`.

### تسجيل الدخول للـ CLI (مرة واحدة لكل جهاز)
الدخول التفاعلي يحتاج terminal حقيقي، فشغّله من نافذة PowerShell عادية:
```powershell
cd D:\Projects\Mukhdar\mukhdar
pnpm exec supabase login
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
pnpm exec supabase link --project-ref ghcohlrzvehtcettaaiu
```

## 3) تطبيق الـ migrations

```bash
pnpm exec supabase db push --remote --dry-run   # يعرض ما سيُطبَّق
pnpm exec supabase db push --remote --yes       # يطبّق
```
- انتبه: بدون `--remote` يحاول الاتصال بقاعدة محلية (Docker) ويفشل.
- لا تعدّل migration مطبقة. أي تغيير = ملف جديد بـ `supabase/migrations/`.

المطبق حالياً على `mukhdar-dev`: `20261110000001_init.sql`، `20261110000002_storage.sql` (T02)، `20261111000001_advisor_fixes.sql` (T03)، `20261111000002_review_fixes.sql` و`20261112000001_sequence_grants.sql` (مراجعة T01–T05)، `20261112000002_inactive_driver_orders.sql`، `20261112000003_push_dispatch.sql` (T07)، `20261112000004_delete_account.sql` (T08)، `20261114000001_address_wording.sql` (نص العنوان بالإشعارات: "وحدة A3 - عمارة 12"؛ طُبّقت 2026-11-14 بموافقة صاحب المشروع)، `20261115000001_order_status_ready.sql` و`20261115000002_ready_flow.sql` (حالة `ready` ومسار السائق؛ طُبّقتا 2026-11-14 بموافقة صاحب المشروع)، `20261115000003_push_reliability.sql` (موثوقية الإشعارات)، `20261115000004_hardening.sql` (push_tokens عبر الدالة فقط، قائمة وحدات البيع)، `20261115000005_deletion_safety.sql` (تسلسل القبول مع حذف الحساب، حفظ الحالة الأصلية)، `20261116000001_phone_pin_auth.sql` (الدخول بالهاتف + PIN: Send SMS hook يرفض، كل حساب برقم صالح، رقم فريد؛ طُبّقت 2026-11-14 بموافقة صاحب المشروع)، `20261117000001_signup_rate_limit.sql` (حدود معدل دالة `signup`؛ طُبّقت 2026-11-15 بموافقة صاحب المشروع)، `20261118000001_set_default_address.sql` (تعيين العنوان الافتراضي بمعاملة واحدة، security invoker؛ طُبّقت 2026-11-15 بموافقة صاحب المشروع)، `20261119000001_revoke_user_sessions.sql` (إبطال كل جلسات مستخدم لـ `admin-reset-pin`، service_role فقط؛ طُبّقت 2026-11-15 بموافقة صاحب المشروع)، `20261120000001_staff_delivery_fallback.sql` (الموظف أيضاً ← بالطريق/تم التوصيل كإجراء احتياطي بدل السائق؛ طُبّقت 2026-11-16 بموافقة صاحب المشروع)، `20261121000001_catalog_stock.sql` (T18: كلفة الحركات، رصيد افتتاحي بالدفتر، هدر/تسويات/صافي ربح بـ daily_stats، حد النقص وإشعار admins_only، دوال المنتجات والمخزون وسحب الكتابة المباشرة؛ طُبّقت 2026-11-16 بموافقة صاحب المشروع).

## 4) توليد أنواع TypeScript

بعد كل migration جديدة:
```bash
pnpm exec supabase gen types typescript --remote > packages/shared/src/database.types.ts
pnpm exec prettier --write packages/shared/src/database.types.ts
```

## 5) فحص Security Advisor

```bash
pnpm exec supabase db advisors --remote
```
(أو من اللوحة: Advisors ← Security Advisor).

**آخر فحص (2026-11-15، للقراءة فقط، بعد كل migrations حتى `20261119000001`): 11 تحذيراً، نفس المقصودة أدناه بلا جديد** (`set_default_address` security invoker، و`revoke_user_sessions` لـ service_role فقط، فلا تظهران). دوال `private.*` و`begin/abort_account_deletion` و`claim/finish_push_notifications` لا تظهر (غير قابلة للتنفيذ من `authenticated`).

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

**التحقق بعد الضبط (التطوير):** `pnpm seed:reset -- --remote && pnpm seed:demo -- --remote` (بموافقة)، ثم الدخول من التطبيق بأدمن العرض `07000000001` والرمز `DEMO_PIN` (أدناه)؛ ومحاولة `signInWithOtp` يجب أن تفشل.

**رمز العرض (التطوير فقط):** كل مستخدمي `seed:demo` (عرض وحمل) يدخلون بنفس الـ PIN: **`482915`** (`DEMO_PIN` بـ `scripts/lib/demo.mjs`). منشور بالـ repo، فلا يُستخدم بالإنتاج أبداً (`seed:demo` يرفض غير التطوير). مستخدمو العرض الحاليون على mukhdar-dev أُنشئوا قبل هذا التغيير **بلا رمز**: يحتاجون `seed:reset` ثم `seed:demo`.

**الإساءة والتخمين:** لا قفل لكل حساب على خطتنا. راقب Authentication ← Logs (محاولات `invalid_credentials` متكررة لنفس الرقم أو كثرة 429). إن ظهرت إساءة: عطّل الحساب المستهدف مؤقتاً من اللوحة إن احتجت، وراجع خطة ADR 0001 (CAPTCHA، T23).

**حساب مراجعي Apple (الإنتاج):** رقم ثابت + PIN يُكتب بملاحظات المراجعة، بدور `customer` فقط.

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
3. **أدمن نسي رمزه** (إعادة الضبط من اللوحة لا تشمل حسابات الأدمن، SPEC-admin §2.6): صاحب المشروع من SQL Editor، برمز جديد غير سهل:
   ```sql
   update auth.users set encrypted_password = extensions.crypt('<PIN جديد>', extensions.gen_salt('bf'))
    where phone = '9647XXXXXXXXX';
   delete from auth.sessions where user_id = (select id from auth.users where phone = '9647XXXXXXXXX');
   ```
   (لا تحفظ الرمز بأي ملف. السطر الثاني يسجّل خروج الحساب من كل الأجهزة.)
4. نسيان رمز زبون أو موظف أو سائق: من لوحة الأدمن، "إعادة ضبط رمز الدخول" (`admin-reset-pin`، T19). قبل T19: نفس SQL الخطوة 3.

## 8) اختبارات قاعدة البيانات (pgTAP، T03)

الملفات: `supabase/tests/NN_*.sql` (14 ملفاً، 503 فحوص)، والدوال المساعدة `supabase/tests/_helpers.sql`، والمشغّل `scripts/db-test.mjs`.

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
3. `seed:demo --scale=load`، ثم `pnpm db:test` مرة ثانية، ثم `seed:reset` و`db:test 09`.
4. التأكد أن `seed:demo` و`db:concurrency` يرفضان هدفاً غير محلي (مع نص الرفض).

وظيفة `ci` تشغّل أيضاً `pnpm test:functions` (`deno check` + `deno test` لـ Edge Functions، fetch مزيف). Deno يُنزَّل عبر `devEngines` بـ `package.json` (مثبّت 2.9.6).

الـ actions مثبّتة بـ commit SHA، ولكل وظيفة `timeout-minutes`، ودفعة جديدة تلغي التشغيل القديم لنفس الفرع.

### Supabase المحلي (`supabase/config.toml`)
مثل الإنتاج المقصود: الدخول **بالهاتف + PIN فقط** (email معطّل، تأكيد الهاتف معطّل، `[auth.hook.send_sms]` يرفض كل رسالة، بلا Test OTPs). هذا للمكدس المحلي فقط؛ إعدادات Auth السحابية تُدار من اللوحة (§6).

### كتابة اختبار جديد
- `tests.new_user(role)`، `tests.new_product(price, stock, active, cost)`، `tests.new_address(customer)`، `tests.place(customer, items)`، `tests.order_in(status, customer, driver)` للتجهيز (بدور postgres).
- `tests.as_user(uid)` / `tests.as_anon()` / `tests.as_postgres()` للتبديل. `tests.remember(name, id)` و `tests.id(name)` لحفظ المعرّفات بين الأدوار.
- `tests.try(sql)` يرجع `OK` أو رمز الخطأ، و`tests.affected(sql)` يرجع عدد الصفوف المتأثرة (لاختبار RLS على update/delete).
- الدوال الجديدة لا تُنفَّذ افتراضياً من `PUBLIC`: دالة تُنشأ داخل ملف اختبار (بعد `_helpers.sql`) أنشئها واستدعها بدور postgres (`tests.as_postgres()`).
- `select plan(N)` يجب أن يساوي عدد الفحوص، والمشغّل يفشل إذا اختلف.

## 9) فحص place_order السريع (T02)

الملف: `supabase/scripts/smoke_place_order.sql`. يعمل كله داخل معاملة تنتهي بـ `ROLLBACK`، فلا يترك أي بيانات.
يفحص: طلب صحيح بمجموع محسوب من القاعدة (السعر المرسل من التطبيق يُتجاهل)، تكرار نفس مفتاح idempotency، رفض عنوان زبون آخر، رفض كمية أكبر من المخزون، منع الزبون من قراءة المخزون وسعر الشراء، ونقص المخزون فعلاً.

```bash
pnpm exec supabase db query --remote -f supabase/scripts/smoke_place_order.sql --yes
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
  pnpm exec supabase db query --remote -f supabase/seed.sql --yes
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
3. `pnpm exec supabase db query --remote -f supabase/seed.sql --yes`، ثم `pnpm seed:demo -- --remote` (يرفع الصور أيضاً).

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
pnpm exec supabase db push --remote --yes                       # migration 20261112000003 (pg_net، pg_cron، السر بـ Vault)
pnpm exec supabase functions deploy push-dispatch --remote=<ref> --use-api --no-verify-jwt --yes
```
ثم رابط الدالة بـ Vault (مرة واحدة لكل بيئة؛ من SQL Editor أو اتصال القاعدة):
```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url',
                           'push-dispatch Edge Function URL');
-- لتغييره: select vault.update_secret((select id from vault.secrets where name = 'push_dispatch_url'), '<url>');
```
- **السر المشترك** `push_dispatch_secret` يولّده الـ migration داخل Vault (32 بايت عشوائية)؛ لا يُنسخ لأي مكان. لتدويره: `vault.update_secret` بقيمة جديدة عشوائية (الدالة تقرؤه من القاعدة بكل طلب، فلا حاجة لإعادة النشر).
- **أسرار الدالة:** `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` تحقنهما Supabase تلقائياً. `EXPO_ACCESS_TOKEN` **اختياري**: يُضبط فقط إن فُعّل "Enhanced push security" بحساب Expo (`supabase secrets set EXPO_ACCESS_TOKEN=... --remote=<ref>`؛ يضبطه صاحب المشروع بنفسه).
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
pnpm exec supabase db push --remote --yes          # migration 20261112000004
pnpm exec supabase functions deploy delete-account --remote=<ref> --use-api --yes   # verify_jwt = true
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
- وحدات أصلية أُضيفت بعد آخر development build (مثل `expo-network`، مراجعة S4) تحتاج بناء dev client جديداً؛ Expo Go يتضمنها.

## 14) التسجيل: Edge Function `signup` (ADR 0001، تحديث 2026-11-15)

التسجيل العام بـ GoTrue **مطفأ**؛ الحساب الجديد يُنشأ فقط من هذه الدالة (`auth.admin.createUser`). تفحص الرقم والـ PIN بالخادم (نفس `packages/shared`)، وحدود المعدل: **20/ساعة لكل IP، 5/ساعة لكل رقم** (`private.signup_rate_limits`). لا تُرجع جلسة: التطبيق يدخل بعدها بـ `signInWithPassword`. لا أسرار إضافية.

### النشر (لكل بيئة، بموافقة صاحب المشروع)، بالترتيب
```bash
pnpm exec supabase db push --remote --yes          # migration 20261117000001
pnpm exec supabase functions deploy signup --remote=<ref> --use-api --no-verify-jwt --yes
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
3. الدخول بحسابات العرض (تطوير فقط) والرمز `DEMO_PIN` = `482915` (§6): أدمن `07000000001`، موظف `07000000002`. (سائق `07000000011` وزبون `07000000101` يرون "غير مصرح".)

**الاختبارات:** `pnpm --filter @mukhdar/admin test` (وحدة)، و`pnpm --filter @mukhdar/admin exec playwright install chromium` مرة واحدة ثم `pnpm --filter @mukhdar/admin test:e2e` (يبني اللوحة ويشغّلها على المنفذ 3100، يدخل بحسابات العرض؛ محلياً ضد المشروع بـ `.env.local`). بـ CI: job `admin-e2e` ضد Supabase محلي + `seed:demo`. حد Auth لكل IP (30/5 دقائق): التشغيل الكامل يدخل ~8 مرات.

**النشر لاحقاً (Vercel، يحتاج موافقة صاحب المشروع):**
- حساب Vercel (الخطة المجانية تكفي للبداية) وربط مستودع GitHub؛ Root Directory = `apps/admin`، Framework = Next.js، أمر التثبيت `pnpm install --frozen-lockfile` (pnpm من `packageManager`).
- متغيرات البيئة بـ Vercel (Preview ← mukhdar-dev، Production ← مشروع الإنتاج): `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` فقط. **لا `service_role` أبداً.**
- نطاق فرعي (مثلاً `admin.<domain>`) وإضافته لـ Supabase ← Authentication ← URL Configuration (Site URL / Redirect URLs) وإن لم تُستخدم روابط بريد.
- بعد النشر: رابط `/delete-account` بـ Google Play Console (Data safety ← Account deletion)، وروابط `/privacy` و`/terms` بـ `EXPO_PUBLIC_PRIVACY_URL` و`EXPO_PUBLIC_TERMS_URL` لتطبيق الزبون وبـ App Store Connect.
- قبل الإنتاج: استبدال بيانات المتجر بـ `apps/admin/src/content/legal.ts` و`IS_DRAFT = false` (SPEC-admin افتراض 15).

**T17:** اختبارات Playwright التي تنشئ وتعدّل طلبات تعمل فقط مع `E2E_ALLOW_WRITES=1` (CI ضد Supabase محلي مع Realtime). لا تضبطه ضد mukhdar-dev؛ بدونه تعمل اختبارات القراءة فقط.

**T18:** اختبارات الكتابة للكتالوج (قسم بصورة، منتج بصورة، مشتريات، هدر، تعطيل) ترفع صوراً، فـ job `admin-e2e` يشغّل `storage-api` أيضاً (لم يعد ضمن `-x`). نفس قاعدة `E2E_ALLOW_WRITES=1`.

**T19:** اختبارات الكتابة للإعدادات والموظفين والعناوين (حفظ الإعدادات، ترقية، تصفير رمز، إنشاء سائق، عمارات بالجملة) تستدعي `admin-reset-pin` و`admin-create-user`، فـ job `admin-e2e` يشغّل `edge-runtime` أيضاً (لم يعد ضمن `-x`). نفس قاعدة `E2E_ALLOW_WRITES=1`. تصفير الرمز يستعمل زبون العرض `07000000119` ويرجعه لـ `DEMO_PIN` بنهاية الاختبار.

## 16) الإعدادات والموظفون: `admin-reset-pin` و`admin-create-user` (T19)
### النشر (لكل بيئة، بموافقة صاحب المشروع)، بالترتيب
```sh
pnpm exec supabase db push --remote --yes          # migration 20261122000001 (update_app_settings، pin_resets، user_creations، add_buildings)
pnpm exec supabase functions deploy admin-reset-pin --remote=<ref> --use-api --yes     # verify_jwt = true
pnpm exec supabase functions deploy admin-create-user --remote=<ref> --use-api --yes   # verify_jwt = true
```
لا أسرار جديدة: `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` تحقنهما Supabase. اللوحة تستدعي الدالتين بجلسة الأدمن (`functions.invoke`).

### اختبار التكامل (`pnpm it:admin-users`، مشروع التطوير فقط)
ينشئ أدمن وزبوناً مؤقتين (البادئة `9647007`) ويختبر الدالتين المنشورتين: الرفض (401/403/`ADMIN_ACCOUNT`/`PIN_INVALID`)، بعد التصفير يفشل الرمز القديم وينجح الجديد ويسقط رمز التحديث القديم، وسائق جديد يدخل برمزه المؤقت ويظهر بـ `list_drivers`، والرقم المكرر ← `PHONE_TAKEN`. يحذف كل الحسابات وسطور `pin_resets`/`user_creations` التي أنشأها حتى عند الفشل.

### التشغيل
- **نسيان الرمز:** الشخص يراسل واتساب المتجر **من نفس الرقم المسجّل** ← الأدمن: الموظفون والسواق ← بحث بالرقم ← "تصفير الرمز" ← رمز عشوائي ← يظهر مرة واحدة ← "إرسال بالواتساب". التصفير يطلّعه من كل الأجهزة (رمز الوصول الحالي يبقى ≤ ساعة).
- **رمز أدمن:** لا يُصفَّر من اللوحة (`ADMIN_ACCOUNT`): صاحبه يغيّره من حسابي، أو صاحب المشروع بـ SQL (§7).
- **الحد:** 20 تصفيراً و20 إنشاءً بالساعة لكل أدمن (من `pin_resets`/`user_creations`). سجل التدقيق: `select * from public.pin_resets order by created_at desc` (بلا الرمز).

### الحالة على mukhdar-dev (2026-11-16)
migration `20261122000001` مطبّقة، والدالتان منشورتان (`verify_jwt = true`)، و`pnpm it:admin-users` نجح (19 فحصاً) والحسابات المؤقتة حُذفت.
