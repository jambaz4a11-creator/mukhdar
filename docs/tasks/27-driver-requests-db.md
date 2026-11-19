# 27: قاعدة بيانات طلبات السواق + تحديث الوثائق ⬜

**الهدف:** SPEC-driver §3 و§4.1 (D1–D13) و§4.5، و"قرارات المالك" بـ SPEC-driver. أساس كل مهام تطبيق السائق.
**يعتمد على:** — (أول مهمة بخطة تطبيق السائق).
**النموذج المقترح:** Opus (أمان: سر الجهاز، صلاحيات `anon`، اختبارات بالدور الحقيقي).
**على dev:** migration جديدة ← `pnpm sb db push --dry-run` ثم `pnpm sb db push` (بموافقة صاحب المشروع) ← `pnpm sb migration list --remote` بلا اختلاف. لا Edge Function.
**الحجم:** M–L (migration واحدة كبيرة + ملف pgTAP + وثائق). إن طال: يُقسم لـ PR للـ DB وPR للوثائق بنفس المهمة.

## الخطوات
1. **الوثائق (قرار المالك: المطوّر الخارجي أُلغي):**
   - `CLAUDE.md`: فقرة "تطبيق السائق خارجي" ← "تطبيق السائق `apps/driver` داخل الـ repo (SPEC-driver)"؛ حذف "لا تغيّر الـ backend الخاص بالسائق إلا باتفاق".
   - `docs/tasks/21-driver-app.md`: "أُلغيت، حلّت محلها T27–T33".
   - `docs/tasks/00-README.md`: صف T21 (🔗 خارجي ← "أُلغيت ← T27–T33") وفقرة "المهمة 21 **خارجية**" تحت الجدول.
   - `docs/DRIVER-API.md`: مقدمة جديدة (عقد داخلي لـ `apps/driver`، لا مطوّر خارجي)، وقسم "التسجيل الذاتي" يشير لـ SPEC-driver §4، وعمود `line_count`.
   - SPEC-backend: §1 (ثلاث واجهات داخلية)، §4 (`driver_requests`)، §5 (الدوال الجديدة والأخطاء)، §6.9 (دوال service_role الجديدة).
2. **migration `2026120800000N_driver_requests.sql`:**
   - D1 جدول `driver_requests` (RLS بلا سياسات، `revoke all`، فهرس فريد جزئي للطلب المفتوح لكل رقم، قيود الصيغة).
   - D2 `private.driver_request_rate_limits` + `driver_request_rate_hit(p_ip, p_phone)` (service_role؛ 10/ساعة IP، 3/24 ساعة رقم؛ `p_phone` null = IP فقط لـ T28).
   - D3 `submit_driver_request` (service_role؛ قفل استشاري لكل رقم، `PHONE_TAKEN`، `REQUEST_EXISTS`، نفس الـ hash ← نفس `id`، `TOO_MANY_PENDING` عند 50، إشعار `admins_only`).
   - D4 `driver_request_status(p_request_id, p_device_secret)` (`anon` و`authenticated`؛ SHA-256 بـ `extensions.digest`؛ `not_found` لأي عدم تطابق).
   - D5 `list_driver_requests(p_status, p_limit)` وD6 `decide_driver_request(p_id, p_approve, p_note)` (أدمن aal2؛ `admin_audit` `driver_request`؛ `REQUEST_ALREADY_DECIDED`، `REQUEST_NOT_FOUND`، `PHONE_TAKEN`).
   - D7 `begin_driver_completion` و`finish_driver_registration` (service_role؛ قفل الصف، انتقال شرطي، الملف الشخصي سائق فعّال بلا `must_change_pin`).
   - D8 قيد `admin_audit_action_check` + `driver_request`.
   - D9 جمهور `driver_request` + عمود `notification_outbox.driver_request_id` + استبدال `claim_push_notifications` (الرمز فقط لطلب ما زال `approved`). التأكد أن شكل المخرجات لم يتغير لـ `push-dispatch` (وإلا تعديل الدالة يُنقل لـ T28).
   - D10 إضافة التنظيف (30 يوماً، وحد المعدل بعد يوم) لمهمة `pg_cron` اليومية.
   - D11 `grant execute` صريح لكل دالة؛ D13 `available_orders` + `line_count` (`drop` + `create` بنفس الصلاحيات والسلوك).
3. D12 توليد `packages/shared/src/database.types.ts`.
4. `packages/shared/src/errors.ts`: `NAME_INVALID`، `REQUEST_EXISTS`، `TOO_MANY_PENDING`، `REGISTER_FAILED`، `REQUEST_NOT_FOUND`، `REQUEST_NOT_APPROVED`، `REQUEST_EXPIRED`، `REQUEST_ALREADY_DECIDED` برسائل عربية (SPEC-driver §2.3).

## القبول
- `anon` يقرأ الحالة بالسر الصحيح فقط، ولا يقرأ `driver_requests` ولا ينفّذ أي دالة أخرى جديدة.
- أدمن aal2 يوافق ويرفض ويُكتب سطر `admin_audit`؛ أدمن aal1 وموظف وسائق وزبون يُرفضون `NOT_ALLOWED`.
- بعد `finish_driver_registration` الحساب سائق فعّال بلا `must_change_pin`، و`available_orders`/`accept_order` تعمل له **بدوره الحقيقي**.
- `available_orders` يرجع `line_count` الصحيح ولا يرجع اسماً ولا هاتفاً ولا طابقاً ولا شقة.
- الوثائق الأربع محدّثة، ولا ذكر لمطوّر خارجي في `CLAUDE.md` و`00-README.md`.
- على dev: `pnpm sb migration list --remote` محلي = بعيد.

## الاختبارات
- pgTAP جديد `supabase/tests/36_driver_requests.sql` (SPEC-driver §7، كل الحالات بالدور الحقيقي `tests.as_user` / `as_user_aal1` / anon).
- تحديث `01_schema.sql` (قائمة دوال service_role والمكشوفة لـ anon)، `05_driver.sql` (`line_count`)، `32_real_role_writes.sql` (الكتابات الجديدة: قرار الأدمن، قراءة الحالة كـ anon).
- `11_push_dispatch.sql`: جمهور `driver_request` (طلب `approved` ← رمزه؛ مرفوض أو مكتمل ← لا شيء).
- Jest: اختبار تطابق رموز `errors.ts` مع SQL وSPEC-backend §5 يمر.
- `pnpm db:test` محلياً (CI) و`pnpm db:test:remote` بعد التطبيق على dev.
