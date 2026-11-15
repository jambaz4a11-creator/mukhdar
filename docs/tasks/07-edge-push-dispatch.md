# 07: Edge Function `push-dispatch` ✅

**الهدف:** إرسال كل ما في `notification_outbox` عبر Expo Push، بشكل موثوق.

## الخطوات
- `supabase/functions/push-dispatch/index.ts` (Deno):
  - تقرأ حتى 200 صف غير مرسل (`sent_at is null and attempts < 5`) مع `for update skip locked` (عبر دالة SQL مساعدة جديدة بـ migration، service_role فقط).
  - تحوّل الجمهور لرموز: `user` ← رموز المستخدم؛ `drivers` ← رموز كل سائق نشط؛ `admins` ← رموز الأدمن والموظفين النشطين.
  - ترسل بدفعات ≤ 100 لـ `https://exp.host/--/api/v2/push/send` (مع `EXPO_ACCESS_TOKEN`).
  - تحدّث `sent_at` أو تزيد `attempts` وتحفظ `last_error`. تحذف الرموز ذات `DeviceNotRegistered`.
  - تفحص الإيصالات (receipts) بالتشغيل التالي (اختياري بالمرحلة الأولى، اكتبه كافتراض إن أُجّل).
- المُشغِّل: Database Webhook على insert + `pg_cron` كل دقيقة كاحتياط.
- Android: `channelId: "orders"` بأولوية عالية.

## القبول
- ⏳ **مؤجل لـ T14** (لا تطبيق بعد): طلب جديد ← إشعار على جهاز سائق حقيقي خلال 10 ثوانٍ. **تحديث T14 (2026-11-15):** تطبيق الزبون يسجّل الرمز ويستقبل الإشعار، لكن Expo Go لا يستقبل إشعارات بعيدة منذ SDK 53، فالفحص بانتظار development build (المتطلبات بـ [T14](14-customer-orders.md#-معلّق-فحص-الجهاز-الحقيقي-القبول-1-و2-والمنقول-من-t07)).
- ✅ بديل مؤقت على `mukhdar-dev`: صف بالصندوق ← عولج عبر Expo الحقيقي خلال ≈ 4 ثوانٍ (انظر أدناه).

## الاختبارات
- اختبار Deno بـ fetch مزيف: تحويل الجمهور، التقسيم لدفعات، تحديث الحالة عند النجاح والفشل، حذف الرمز الميت.
- اختبار pgTAP لدالة الحجز (صفان متزامنان لا يأخذان نفس الصف).

## ما نُفّذ (2026-11-12)
- **مزوّد لكل رمز** (طلب صاحب المشروع): `push_tokens.provider` (`expo` افتراضي، `fcm` محجوز)، و`register_push_token(p_token, p_platform, p_provider = 'expo')` (رمز expo يجب أن يكون `ExponentPushToken[...]`/`ExpoPushToken[...]`). مُرسِل Expo فقط الآن؛ رموز fcm تُتخطى بـ `last_error = "fcm: N token(s) skipped (provider not implemented)"`. DRIVER-API §3.4 و§6 محدّثان.
- migration `20261112000003_push_dispatch.sql`: `claimed_at` + `claim_push_notifications` (`for update skip locked`، حجز 5 دقائق، المستلمون مع مزوّدهم) + `finish_push_notifications` (النتيجة + حذف الرموز الميتة؛ الفشل المؤقت يُعاد بعد 5 دقائق) + `push_dispatch_authorized` (سر مشترك يولّده الـ migration بـ Vault). كلها لـ service_role فقط (SECURITY INVOKER عدا التحقق من السر).
- **المُشغِّل:** بدل Database Webhook من اللوحة: trigger بالـ migration (`after insert for each statement`) يستدعي الدالة بـ `pg_net`، + `pg_cron` كل دقيقة إن بقي شيء. الرابط بـ Vault (`push_dispatch_url`) لكل بيئة؛ بدونه لا طلبات (محلياً/CI). نفس الأثر، لكنه بالـ git ويُختبر.
- `supabase/functions/push-dispatch/`: `dispatch.ts` (المنطق)، `expo.ts` (دفعات ≤100، `channelId: orders`، أولوية عالية، `EXPO_ACCESS_TOKEN` اختياري)، `handler.ts` (POST فقط، 401 بدون السر الصحيح، 500 بلا تفاصيل)، `index.ts` (الربط بـ supabase-js). `verify_jwt = false` (المصادقة بالسر).
- **الإيصالات مؤجلة** (SPEC-backend افتراض 28).
- منشور على `mukhdar-dev` فقط، و`push_dispatch_url` مضبوط هناك. `EXPO_ACCESS_TOKEN` غير مطلوب.

## نتائج الاختبارات
- Deno (`pnpm test:functions`، 14): الدفعات 250 ← 100/100/50، تحويل الجمهور لرسائل، نجاح/فشل/نهائي بالمحاولة الخامسة، حذف `DeviceNotRegistered`، تخطي fcm، بلا مستلمين، ترويسة Authorization فقط مع الرمز، المعالج (405/401/500).
- pgTAP `11_push_dispatch.sql` (50): الصلاحيات، المزوّد والتحقق من الصيغة، الجمهور (غير النشطين مستبعدون)، الحجز (حجز ثانٍ لا يأخذ شيئاً، الحد، انتهاء الحجز)، الإنهاء، السر، trigger/cron وطلب pg_net مع الترويسة. المجموع على `mukhdar-dev`: 11 ملفاً، 375 فحصاً.
- تزامن حقيقي (`db:concurrency`، CI محلياً): 4 عمال service_role يحجزون بنفس اللحظة ← لا صف مكرر.
- فحص طرفي على `mukhdar-dev`: انظر RUNBOOK §11.
