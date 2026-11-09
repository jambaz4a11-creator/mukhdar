# 02: مشروع Supabase للتطوير

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
