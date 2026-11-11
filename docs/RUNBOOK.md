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

المطبق حالياً على `mukhdar-dev` (T02): `20261110000001_init.sql`، `20261110000002_storage.sql`.

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

نتيجة T02 (2026-11-11): **لا توجد نتائج بمستوى ERROR**. التحذيرات (WARN) الموجودة:
- `authenticated_security_definer_function_executable` (12 دالة RPC): **مقصود**. هذه هي الواجهة الوحيدة للكتابة الحساسة (SPEC-backend §5)، وكل دالة تتحقق من `auth.uid()` والدور بداخلها.
- `anon_security_definer_function_executable` على `current_user_role`، `is_admin`، `is_staff_or_admin`: دوال مساعدة تُستخدم داخل سياسات RLS، وترجع null/false للزائر. تُراجع بـ T03.
- `function_search_path_mutable` على `set_updated_at`، `baghdad_today`، `round_iqd`: ليست security definer، فالخطر منخفض. تُصلَح بـ migration جديدة (تثبيت `search_path`) ضمن مهمة لاحقة.
- أداء: `auth_rls_initplan` (6) و `multiple_permissive_policies` (40). تُعالج ضمن مراجعة الأداء (SPEC-backend §9)، وليست أمنية.

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

## 8) فحص place_order (اختبار T02)

الملف: `supabase/tests/smoke_place_order.sql`. يعمل كله داخل معاملة تنتهي بـ `ROLLBACK`، فلا يترك أي بيانات.
يفحص: طلب صحيح بمجموع محسوب من القاعدة (السعر المرسل من التطبيق يُتجاهل)، تكرار نفس مفتاح idempotency، رفض عنوان زبون آخر، رفض كمية أكبر من المخزون، منع الزبون من قراءة المخزون وسعر الشراء، ونقص المخزون فعلاً.

```bash
pnpm exec supabase db query --remote -f supabase/tests/smoke_place_order.sql --yes
```
النجاح: يرجع صفاً واحداً `"result": "SMOKE OK"`. الفشل: خطأ يبدأ بـ `SMOKE FAIL` أو اسم الخطأ.

من SQL Editor باللوحة: الصق محتوى الملف كاملاً وشغّله. النتيجة نفسها.
