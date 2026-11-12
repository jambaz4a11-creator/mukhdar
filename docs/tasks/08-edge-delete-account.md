# 08: Edge Function `delete-account` ✅

**الهدف:** حذف الحساب من داخل التطبيق (شرط Apple وGoogle).

## الخطوات
- `supabase/functions/delete-account/index.ts`:
  - يتحقق من JWT المستخدم.
  - يرفض (`409 ACTIVE_ORDER`) إن كان له طلب بحالة غير نهائية.
  - يرفض حذف حساب `admin` (لا يُحذف إلا يدوياً).
  - `auth.admin.deleteUser(uid)`: يمتد الحذف لـ `profiles` والعناوين والرموز، والطلبات تبقى بـ `customer_id = null`.
- ⏳ **مؤجل لـ T16** (لا يوجد تطبيق أدمن بعد): صفحة ويب عامة "طلب حذف الحساب" (مطلوبة لـ Google Play) بلوحة الأدمن، تشرح الخطوات. أُضيفت صراحة لـ `16-admin-scaffold.md`.

## القبول
- بعد الحذف: لا يمكن الدخول بنفس الجلسة، والطلبات القديمة تظهر بالتقارير.

## الاختبارات
- اختبار Deno: بدون JWT ← 401؛ طلب نشط ← 409؛ admin ← 403؛ نجاح ← استدعاء deleteUser.
- اختبار تكامل على مشروع التطوير: الطلبات باقية بعد الحذف و`customer_id` فارغ.

## ما نُفّذ (2026-11-12)
- migration `20261112000004_delete_account.sql`: `begin_account_deletion(p_user_id)` (service_role فقط): نفس قفل `place_order` للمستخدم، يرفض `ADMIN_ACCOUNT` و`ACTIVE_ORDER` (زبون بطلب غير منتهٍ **أو سائق معيَّن لطلب غير منتهٍ**)، ويعطّل الحساب (فلا طلب/قبول جديد بين الفحص والحذف)؛ `abort_account_deletion` يرجع الحالة إن فشل `deleteUser`.
- `supabase/functions/delete-account/`: `handler.ts` (POST فقط؛ JWT ← `auth.getUser`؛ 401/403/404/409/500 بجسم `{error: CODE}`؛ 200 `{deleted: true}`)، `index.ts` (supabase-js بمفتاح الخدمة المحقون). `verify_jwt = true`.
- رمزان جديدان بـ SPEC-backend §5 و`errors.ts`: `ACTIVE_ORDER`، `ADMIN_ACCOUNT`. و`parseBackendError` يقرأ جسم رد Edge Function `{error: CODE}`.
- منشور على `mukhdar-dev` فقط. DRIVER-API §8 (طريقة الاستدعاء والردود؛ السؤال المفتوح 2 محسوم).

## نتائج الاختبارات
- Deno (8 لهذه الدالة، 22 مع push-dispatch): بدون JWT ← 401؛ JWT غير صالح ← 401؛ طلب نشط ← 409؛ admin ← 403؛ نجاح ← `deleteUser` بمعرّف صاحب الـ JWT؛ فشل `deleteUser` ← `abort` و500؛ خطأ غير متوقع ← 500 بلا تفاصيل؛ POST فقط.
- pgTAP `12_delete_account.sql` (32): الصلاحيات، الرفض (admin، زبون بطلب pending، سائق بطلب out_for_delivery، مستخدم غير موجود)، التعطيل يمنع `place_order`، الإرجاع، ثم بعد حذف `auth.users`: الملف والعناوين والرموز محذوفة؛ الطلبات والبنود والتقييم والسجل باقية بـ `customer_id`/`driver_id` = null؛ `daily_stats` لم تتغير. المجموع على `mukhdar-dev`: 12 ملفاً، 407 فحوص.
- تكامل على `mukhdar-dev` (`pnpm it:delete-account`، 15 فحصاً): مستخدم مؤقت يُنشأ ويُحذف داخل الاختبار (لا يلمس مستخدمي العرض) ← 401 بلا JWT، 409 مع طلب نشط، 200 بعد إنهائه؛ المستخدم والملف محذوفان؛ الطلبان باقيان بـ `customer_id = null`؛ رمز الوصول القديم مرفوض ورمز التحديث مُلغى. بعده: 0 بقايا، و25 مستخدماً و500 طلب كما كانت.
- ملاحظة: دخول الهاتف معطّل بـ Auth مشروع التطوير، فالمستخدم المؤقت يدخل بالبريد وكلمة سر عشوائية (لم تُغيَّر إعدادات Auth).
