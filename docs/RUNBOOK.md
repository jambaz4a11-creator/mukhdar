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

المطبق حالياً على `mukhdar-dev`: `20261110000001_init.sql`، `20261110000002_storage.sql` (T02)، `20261111000001_advisor_fixes.sql` (T03).

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

نتيجة بعد T03 (2026-11-11): **9 تحذيرات فقط، كلها مقصودة**: `authenticated_security_definer_function_executable` على دوال RPC التسع (`place_order`، `set_order_status`، `available_orders`، `accept_order`، `assign_driver`، `rate_order`، `register_push_token`، `adjust_stock`، `set_user_role`). هذه هي الواجهة الوحيدة للكتابة الحساسة (SPEC-backend §5)، وكل دالة تتحقق من `auth.uid()` والدور بداخلها.

أي تحذير جديد غير هذه التسعة = شيء يحتاج إصلاح. (اختبار `01_schema.sql` يفحص نفس القواعد تلقائياً.)

تاريخياً، نتيجة T02 كانت 64 تحذيراً، وأصلحتها migration `20261111000001_advisor_fixes.sql`:
- `search_path` ثابت للدوال الثلاث.
- دوال الأدوار security definer انتقلت لمخطط `private` (غير مكشوف بالـ API)، والأسماء بـ `public` صارت security invoker.
- السياسات تستخدم `(select auth.uid())` و `(select private.is_admin())`، وسياسات الأدمن `for all` انقسمت لـ insert/update/delete.

## 6) Auth: الدخول برقم الهاتف (خطوات يدوية من اللوحة)

> لم تُنفَّذ بـ T02 لأنها تغيير بإعدادات الخدمة السحابية ولم تُطلب موافقة عليه بعد. تُنفَّذ من صاحب المشروع.

1. Dashboard ← Authentication ← Sign In / Providers ← **Phone**: فعّله.
   (قد تطلب اللوحة مزود SMS. اختيار المزود الفعلي من مهمة T04.)
2. نفس الصفحة ← **Test OTPs** (أرقام اختبار برمز ثابت، بدون إرسال رسائل)، مثلاً:
   ```
   9647700000001=123456
   9647700000002=123456
   ```
   أرقام الاختبار للتطوير فقط، وتُحذف من مشروع الإنتاج (عدا حساب مراجعي Apple، انظر CLAUDE.md).

## 7) إنشاء أول أدمن

1. سجّل الدخول برقم اختبار (من التطبيق لاحقاً، أو من Authentication ← Users ← Add user ← phone).
   الـ trigger `on_auth_user_created` ينشئ له `profiles` بدور `customer`.
2. من SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where phone = '9647700000001';
   ```
   ملاحظة: Supabase يخزن `auth.users.phone` **بدون `+`** عادةً، والـ trigger ينسخه كما هو. تأكد بـ:
   ```sql
   select id, phone, role from public.profiles;
   ```

## 8) اختبارات قاعدة البيانات (pgTAP، T03)

الملفات: `supabase/tests/NN_*.sql` (253 فحصاً)، والدوال المساعدة `supabase/tests/_helpers.sql`، والمشغّل `scripts/db-test.mjs`.

- كل ملف يعمل داخل `BEGIN ... ROLLBACK`: امتداد `pgtap` ومخطط `tests` وبيانات الاختبار كلها تُنشأ داخل المعاملة وتُلغى. **لا يبقى شيء بقاعدة البيانات**، ولا حاجة لتفعيل pgtap بشكل دائم.
- لا نستخدم `supabase test db` محلياً لأنه يحتاج Docker.

### على مشروع التطوير (من ويندوز)
```bash
pnpm db:test:remote          # كل الملفات
pnpm db:test:remote 03 04    # ملفات محددة
```
يحتاج:
1. `supabase link` (يوفر `supabase/.temp/pooler-url`).
2. `SUPABASE_DB_PASSWORD` بـ `.env.local`.
3. شهادة **Supabase Root 2021 CA** بـ `supabase/certs/prod-ca-2021.crt` (مرفوعة بالـ git؛ شهادة عامة). المصدر: Dashboard ← Project Settings ← Database ← SSL Configuration ← Download certificate. الاتصال يتحقق من الشهادة بالكامل.
   بصمة SHA-256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA` (صالحة حتى 2031-04-26).

### في CI
وظيفة `db-tests` بـ `.github/workflows/ci.yml`: `supabase start` (Docker على runner GitHub، تُطبَّق الـ migrations تلقائياً) ثم `pnpm db:test` على القاعدة المحلية. **لا اتصال بالسحابة ولا كلمة سر بـ GitHub.**

### كتابة اختبار جديد
- `tests.new_user(role)`، `tests.new_product(price, stock, active, cost)`، `tests.new_address(customer)`، `tests.place(customer, items)`، `tests.order_in(status, customer, driver)` للتجهيز (بدور postgres).
- `tests.as_user(uid)` / `tests.as_anon()` / `tests.as_postgres()` للتبديل. `tests.remember(name, id)` و `tests.id(name)` لحفظ المعرّفات بين الأدوار.
- `select plan(N)` يجب أن يساوي عدد الفحوص، والمشغّل يفشل إذا اختلف.

## 9) فحص place_order السريع (T02)

الملف: `supabase/scripts/smoke_place_order.sql`. يعمل كله داخل معاملة تنتهي بـ `ROLLBACK`، فلا يترك أي بيانات.
يفحص: طلب صحيح بمجموع محسوب من القاعدة (السعر المرسل من التطبيق يُتجاهل)، تكرار نفس مفتاح idempotency، رفض عنوان زبون آخر، رفض كمية أكبر من المخزون، منع الزبون من قراءة المخزون وسعر الشراء، ونقص المخزون فعلاً.

```bash
pnpm exec supabase db query --remote -f supabase/scripts/smoke_place_order.sql --yes
```
النجاح: يرجع صفاً واحداً `"result": "SMOKE OK"`. الفشل: خطأ يبدأ بـ `SMOKE FAIL` أو اسم الخطأ.

من SQL Editor باللوحة: الصق محتوى الملف كاملاً وشغّله. النتيجة نفسها.
