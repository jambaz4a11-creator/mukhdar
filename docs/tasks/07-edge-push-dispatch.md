# 07: Edge Function `push-dispatch`

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
- طلب جديد ← إشعار على جهاز سائق حقيقي خلال 10 ثوانٍ.

## الاختبارات
- اختبار Deno بـ fetch مزيف: تحويل الجمهور، التقسيم لدفعات، تحديث الحالة عند النجاح والفشل، حذف الرمز الميت.
- اختبار pgTAP لدالة الحجز (صفان متزامنان لا يأخذان نفس الصف).
