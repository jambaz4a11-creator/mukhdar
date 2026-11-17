# 23: مراجعة الأمان

**الهدف:** لا تسرب بيانات ولا صلاحيات زائدة قبل الإطلاق.

## قائمة الفحص
- [x] Supabase Security Advisor و Performance Advisor: صفر تحذيرات حرجة.
- [x] كل جدول بـ `public` عليه RLS (استعلام على `pg_tables` حيث `rowsecurity = false` يرجع صفراً).
- [x] لا دالة `security definer` بدون `search_path` (استعلام على `pg_proc`).
- [x] قائمة الدوال القابلة للتنفيذ من `anon`/`authenticated` تطابق SPEC-backend §5 فقط.
- [x] `service_role` غير موجود بأي حزمة تطبيق أو كود متصفح (بحث بالمستودع وبحزم البناء).
- [x] اختبار يدوي بـ REST مباشرة (curl بتوكن زبون): قراءة `product_costs`، `stock`، طلبات غيره، تعديل `role`، إدخال طلب مباشر: كلها مرفوضة.
- [x] الدخول بالهاتف + PIN (ADR 0001): الـ SMS hook يرفض فعلاً على الإنتاج؛ حد الدخول لكل IP مضبوط؛ مراجعة Auth logs لمحاولات تخمين؛ قرار CAPTCHA (Turnstile/hCaptcha) لـ signup/signin؛ قرار قفل لكل حساب (Password Verification Hook بخطة Teams أو دخول عبر Edge Function).
- [x] `admin-reset-pin`: أدمن فقط، لا لحسابات الأدمن، الحد، سجل التدقيق، الرمز لا يُسجَّل.
- [x] Storage: لا رفع إلا للأدمن، وحد الحجم والأنواع مفعّل.
- [x] الأسرار بمتغيرات بيئة Vercel/EAS/Supabase فقط.

## القبول
- كل البنود ✓ وموثقة بـ `docs/ADR/0003-security-review.md`.

## الاختبارات
- تحويل الاستعلامات الثلاثة الأولى لاختبارات pgTAP دائمة.

## الحالة (2026-11-17): ✅ منجزة

المراجعة والإصلاحات كلها منجزة (جلستا E1 وE2، ثم جلسة F لبنود [مراجعتهما](../reviews/review-E1-E2.md) الـ 15): [التقرير](../reviews/security-T23.md) (حالة كل بند بجدوله الأخير)، والقرارات والمخاطر المقبولة بـ [ADR 0003](../ADR/0003-security-review.md). على mukhdar-dev: migrations حتى `20261201000001`، `admin-reset-pin` و`admin-create-user` أُعيد نشرهما، `seed:reset` ثم `seed:demo`، و`it:admin-users` و`it:break-glass` و`it:signup` و`it:delete-account` نجحت. اختبارات pgTAP الدائمة: `01_schema.sql` (RLS، `search_path`، قائمة الدوال) و`27_access_matrix.sql` و`28_mfa_aal.sql` و`30_security_e2.sql`. **يدوي بالإنتاج (لم يُنفَّذ، بموافقة المالك لاحقاً):** قائمة RUNBOOK §17.5 (Auth وVercel وGitHub وEAS وRealtime وDependabot).
