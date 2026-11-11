# 02: مشروع Supabase للتطوير ✅

**الهدف:** قاعدة بيانات تعمل بالمخطط الحالي، **بدون Docker** على ويندوز (توفيراً للقرص والذاكرة).

## الخطوات
- إنشاء مشروع Supabase سحابي مجاني باسم `mukhdar-dev` (منطقة قريبة، مثل Frankfurt). **باسم/إيميل صاحب المشروع.**
- `supabase link --project-ref <ref>` ثم `supabase db push` لتطبيق `supabase/migrations/*`.
- Auth: تفعيل Phone provider. أثناء التطوير: أرقام اختبار بـ OTP ثابت (Auth ← Phone ← Test OTPs) حتى لا نصرف على الرسائل.
- إنشاء أول أدمن: سجّل دخولاً برقم اختبار ثم من SQL Editor:
  `update public.profiles set role = 'admin' where phone = '+9647XXXXXXXXX';`
- `supabase gen types typescript --linked > packages/shared/src/database.types.ts`.
- توثيق كل هذا بـ `docs/RUNBOOK.md`.

## القبول
- كل migrations مطبقة بلا أخطاء، و Security Advisor بلوحة Supabase بلا تحذيرات حرجة.
- `database.types.ts` مولّد ومرفوع.

## الاختبارات
- فحص سريع: استدعاء `place_order` من SQL Editor بمستخدم اختبار (موثق بالـ RUNBOOK).

## ملاحظة
مشاريع Supabase المجانية تتوقف بعد فترة عدم نشاط: هذا مقبول للتطوير فقط.

## ما نُفّذ (2026-11-11)
- المشروع موجود مسبقاً (`mukhdar-dev`، ref `ghcohlrzvehtcettaaiu`) بمنطقة **سنغافورة `ap-southeast-1`** لا فرانكفورت. مقبول للتطوير. **الإنتاج يجب أن يكون بفرانكفورت `eu-central-1`** (انظر RUNBOOK §1).
- الربط وتطبيق الـ migrations والأنواع وفحص Advisor وفحص `place_order`: منجزة، والتفاصيل بـ `docs/RUNBOOK.md`.
- **متبقٍ يدوياً من صاحب المشروع:** تفعيل Phone provider وأرقام Test OTPs وإنشاء أول أدمن (RUNBOOK §6–7)، لأنها تغييرات بإعدادات الخدمة السحابية.
