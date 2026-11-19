# 28: Edge Functions تسجيل السائق ⬜

**الهدف:** SPEC-driver §4.2 (`driver-register`) و§4.4 (`driver-complete-registration`).
**يعتمد على:** 27.
**النموذج المقترح:** Opus (إنشاء حسابات بـ service_role، سر الجهاز، تراجع عند الفشل).
**على dev:** نشر دالتين جديدتين (`supabase functions deploy driver-register driver-complete-registration`، `verify_jwt = false`) وأي سر لازم، **بموافقة صاحب المشروع**. لا migration (إلا إذا ظهر بـ T27 أن `push-dispatch` يحتاج تعديلاً لجمهور `driver_request`، فيُنشر هنا أيضاً).
**الحجم:** M.

## الخطوات
1. `supabase/functions/driver-register/{index.ts,handler.ts,driver_register_test.ts}` بنمط `signup` (handler قابل للاختبار، `createSignupServer`-مثل، `_shared/keys.ts`، `_shared/cors.ts`):
   - الترتيب: جسم صالح ← `driver_request_rate_hit(ip, phone)` ← `normalizeIraqiPhone` ← الاسم ← السر (base64url = 32 بايت) ← `push_token` (Expo أو يُتجاهل) ← SHA-256 ← `submit_driver_request`.
   - الردود: 201 `{request_id}`؛ 400 `INVALID_REQUEST`/`PHONE_INVALID`/`NAME_INVALID`؛ 409 `PHONE_TAKEN`/`REQUEST_EXISTS`؛ 429 `RATE_LIMITED`/`TOO_MANY_PENDING`؛ 500 `REGISTER_FAILED`.
2. `supabase/functions/driver-complete-registration/...`:
   - الترتيب: جسم صالح ← حد IP ← SHA-256 ← `begin_driver_completion` ← `validatePin(normalizePin(pin), phone)` ← `auth.admin.createUser({phone, password, phone_confirm: true})` ← `finish_driver_registration`؛ فشلها ← `auth.admin.deleteUser` و500 `INTERNAL`.
   - الردود: 201 `{created: true}`؛ 400 `PIN_INVALID` (`detail`)؛ 404 `REQUEST_NOT_FOUND`؛ 409 `REQUEST_NOT_APPROVED`/`PHONE_TAKEN`؛ 410 `REQUEST_EXPIRED`؛ 429؛ 500.
   - لا تسجيل للجسم ولا السر ولا الرمز (`errTextWithout`).
3. `package.json`: إضافة الدالتين لـ `test:functions` (`deno check`).
4. `scripts/driver-register-it.mjs` + `pnpm it:driver-register` (dev فقط؛ يرفض الإنتاج كبقية سكربتات `it:*`): تسجيل ← `pending` ← موافقة بأدمن العرض (aal2) ← سر خاطئ يفشل ← اختيار الرمز ← `signInWithPassword` ← `available_orders` ← حذف الحساب والطلب.
5. SPEC-backend §8 (صفّان جديدان بجدول الدوال) وRUNBOOK (قسم نشر الدالتين ومراقبتهما).

## القبول
- لا حساب Auth يُنشأ بـ `driver-register` أبداً.
- `driver-complete-registration` بسر خاطئ أو طلب `pending`/`rejected`/منتهٍ ← لا حساب.
- ضغطتان متزامنتان على "تأكيد" ← حساب واحد؛ الثانية `PHONE_TAKEN` أو `REQUEST_NOT_APPROVED` والحالة `completed`.
- فشل `finish_driver_registration` يحذف الحساب المُنشأ (لا حساب يتيم بدور `customer`).
- الحد يُفحص قبل أي عمل آخر.
- `pnpm it:driver-register` ينجح على dev.

## الاختبارات
- `deno test` (fetch مزيف) للدالتين: كل رمز خطأ وحالته HTTP، ترتيب الخطوات، الحد، السر/الرمز غير موجودين بأي سطر سجل، التراجع عند الفشل، `PHONE_TAKEN` من GoTrue.
- `pnpm test:functions` بـ CI.
- تكامل `pnpm it:driver-register` على dev بعد النشر.
