# 16: هيكل لوحة الأدمن والدخول

**الهدف:** SPEC-admin §1.

## الخطوات
- `apps/admin`: Next.js (App Router، TypeScript)، Tailwind مع RTL، خط عربي.
- `@supabase/ssr` بـ cookies. دخول هاتف + OTP.
- `middleware.ts`: حماية كل المسارات عدا `/login` والصفحات العامة (`/privacy`، `/terms`، `/delete-account`).
- تخطيط بقائمة جانبية حسب الدور.
- النشر على Vercel (مشروع preview مرتبط بمشروع Supabase للتطوير).

## القبول
- أدمن وموظف يدخلان؛ زبون يرى "غير مصرح"؛ موظف لا يصل لـ `/products` حتى بالرابط.

## الاختبارات
- Playwright: الحالات الثلاث أعلاه.
- وحدة: دالة تحديد الصفحات المسموحة للدور.
