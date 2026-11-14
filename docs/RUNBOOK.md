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

المطبق حالياً على `mukhdar-dev`: `20261110000001_init.sql`، `20261110000002_storage.sql` (T02)، `20261111000001_advisor_fixes.sql` (T03)، `20261111000002_review_fixes.sql` و`20261112000001_sequence_grants.sql` (مراجعة T01–T05)، `20261112000002_inactive_driver_orders.sql`، `20261112000003_push_dispatch.sql` (T07)، `20261112000004_delete_account.sql` (T08)، `20261114000001_address_wording.sql` (نص العنوان بالإشعارات: "وحدة A3 - عمارة 12"؛ طُبّقت 2026-11-14 بموافقة صاحب المشروع)، `20261115000001_order_status_ready.sql` و`20261115000002_ready_flow.sql` (حالة `ready` ومسار السائق؛ طُبّقتا 2026-11-14 بموافقة صاحب المشروع)، `20261115000003_push_reliability.sql` (موثوقية الإشعارات)، `20261115000004_hardening.sql` (push_tokens عبر الدالة فقط، قائمة وحدات البيع)، `20261115000005_deletion_safety.sql` (تسلسل القبول مع حذف الحساب، حفظ الحالة الأصلية).

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

**آخر فحص (2026-11-14، للقراءة فقط، بعد دوال T07/T08 و`pg_net`/`pg_cron` وكل migrations حتى `20261115000005`): 11 تحذيراً، نفس المقصودة أدناه بلا جديد.** دوال `private.*` و`begin/abort_account_deletion` و`claim/finish_push_notifications` لا تظهر (غير قابلة للتنفيذ من `authenticated`).

نتيجة بعد مراجعة T01–T05 (2026-11-11): **10 تحذيرات مقصودة**: `authenticated_security_definer_function_executable` على دوال RPC العشر (`place_order`، `set_order_status`، `available_orders`، `accept_order`، `assign_driver`، `list_drivers`، `rate_order`، `register_push_token`، `adjust_stock`، `set_user_role`). هذه هي الواجهة الوحيدة للكتابة الحساسة (SPEC-backend §5)، وكل دالة تتحقق من `auth.uid()` والدور بداخلها.

بالإضافة: `auth_leaked_password_protection` (إعداد Auth، لا يخص الدخول بالهاتف؛ يُفعَّل من اللوحة إن رغب صاحب المشروع).

أي تحذير جديد غير هذه = شيء يحتاج إصلاح. (اختبار `01_schema.sql` يفحص نفس القواعد تلقائياً.)

تاريخياً، نتيجة T02 كانت 64 تحذيراً، وأصلحتها migration `20261111000001_advisor_fixes.sql`:
- `search_path` ثابت للدوال الثلاث.
- دوال الأدوار security definer انتقلت لمخطط `private` (غير مكشوف بالـ API)، والأسماء بـ `public` صارت security invoker.
- السياسات تستخدم `(select auth.uid())` و `(select private.is_admin())`، وسياسات الأدمن `for all` انقسمت لـ insert/update/delete.

## 6) Auth: الدخول برقم الهاتف (خطوات يدوية من اللوحة)

> لم تُنفَّذ بـ T02 لأنها تغيير بإعدادات الخدمة السحابية ولم تُطلب موافقة عليه بعد. تُنفَّذ من صاحب المشروع.
>
> **الحالة على mukhdar-dev (2026-11-14):** الدخول بالهاتف **معطّل** ولا توجد Test OTPs (`phone_provider_disabled`). قرار صاحب المشروع: يُفعَّل مع مهمة مزوّد SMS (T04)، قبل T10. حتى ذلك الحين لا أحد يدخل بالهاتف على dev (ولا مطوّر تطبيق السائق)؛ اختبار التكامل `it:delete-account` يدخل بالبريد لمستخدم مؤقت.

1. Dashboard ← Authentication ← Sign In / Providers ← **Phone**: فعّله.
   (قد تطلب اللوحة مزود SMS. اختيار المزود الفعلي من مهمة T04.)
2. نفس الصفحة ← **Test OTPs** (أرقام اختبار برمز ثابت، بدون إرسال رسائل)، مثلاً:
   ```
   9647000000901=123456
   9647000000902=123456
   ```
   استخدم البادئة `9647000` (لا تتبع أي شركة اتصالات عراقية) ولا تستخدم أرقاماً تبدو حقيقية مثل `0770…`/`0780…`.
   أرقام الاختبار للتطوير فقط، وتُحذف من مشروع الإنتاج (عدا حساب مراجعي Apple، انظر CLAUDE.md).

   > **تحذير:** رقم Test OTP يدخل به **أي شخص** يعرف الرمز الثابت. لا تعطِ رقم اختبار دور `admin` أو `staff` أو `driver` بأي مشروع غير التطوير. حساب مراجعي Apple بالإنتاج يبقى `customer` فقط.

## 7) إنشاء أول أدمن

1. **التطوير:** سجّل الدخول برقم اختبار (من التطبيق لاحقاً، أو من Authentication ← Users ← Add user ← phone).
   **الإنتاج:** برقم هاتف حقيقي لصاحب المشروع (OTP حقيقي)، **أبداً** برقم Test OTP.
   الـ trigger `on_auth_user_created` ينشئ له `profiles` بدور `customer`.
2. من SQL Editor (مثال التطوير):
   ```sql
   update public.profiles set role = 'admin' where phone = '9647000000901';
   ```
   ملاحظة: Supabase يخزن `auth.users.phone` **بدون `+`** عادةً، والـ trigger ينسخه كما هو. تأكد بـ:
   ```sql
   select id, phone, role from public.profiles;
   ```

## 8) اختبارات قاعدة البيانات (pgTAP، T03)

الملفات: `supabase/tests/NN_*.sql` (12 ملفاً، 407 فحوص)، والدوال المساعدة `supabase/tests/_helpers.sql`، والمشغّل `scripts/db-test.mjs`.

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
مثل الإنتاج المقصود: الدخول **بالهاتف فقط** (email معطّل)، مع Test OTP محلية `9647000000901..903` = `123456` (بدون إرسال رسائل). هذا للمكدس المحلي فقط؛ إعدادات Auth السحابية تُدار من اللوحة (§6).

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
  للدخول بها من التطبيق لاحقاً: أضفها كـ Test OTPs (§6). **غير مضبوطة على mukhdar-dev بعد** (الدخول بالهاتف معطّل حتى T04).
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

2026-11-14 (بموافقة صاحب المشروع): `20261115000003_push_reliability.sql` مطبّق والدالة أُعيد نشرها (تقسيم مشاريع Expo). فحص طرفي: صف `admins` بلا رموز ← عولج خلال ≈ 4 ثوانٍ (`no recipients`) ثم حُذف.

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
ينشئ مستخدماً مؤقتاً (هاتف `9647005xxxxxx` + بريد `t08-…@example.com`، كلمة سر عشوائية) عبر Auth Admin API، يجرّب الرفض والحذف عبر الدالة المنشورة، ويحذف كل ما أنشأه حتى عند الفشل. يحتاج `SUPABASE_DB_PASSWORD` و`SUPABASE_SERVICE_ROLE_KEY` بـ `.env.local`. ليس بـ CI (يحتاج الدالة المنشورة ومفتاح الخدمة). دخول الهاتف معطّل بمشروع التطوير، لذلك يدخل المستخدم المؤقت بالبريد.

### الحالة على mukhdar-dev (2026-11-12)
الـ migration مطبّق والدالة منشورة. اختبار التكامل: 15/15، بلا بقايا.

### مستخدم يملك ملفات بـ Storage (N9)
`auth.admin.deleteUser` يرفض حذف مستخدم يملك كائنات بـ Storage (`storage.objects.owner`). اليوم يرفع الأدمن فقط صور المنتجات، والأدمن لا يُحذف من التطبيق أصلاً، فلا أثر الآن. إن صار غير الأدمن يرفع ملفات لاحقاً (أو احتجت حذف أدمن رفع صوراً): انقل ملكية كائناته أولاً (`update storage.objects set owner = null where owner = '<id>'` من SQL Editor) ثم احذفه. حذف الكائنات نفسها عبر Storage API لا بـ SQL.

### حذف حساب أدمن (يدوياً)
الدالة ترفض حساب `admin`. لحذفه: أنزل دوره أولاً من أدمن آخر (`set_user_role`)، ثم يحذف حسابه من التطبيق، أو احذفه من Dashboard ← Authentication ← Users.
