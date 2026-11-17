# 23: مراجعة الأمان

**الهدف:** لا تسرب بيانات ولا صلاحيات زائدة قبل الإطلاق.

## قائمة الفحص
- [ ] Supabase Security Advisor و Performance Advisor: صفر تحذيرات حرجة.
- [ ] كل جدول بـ `public` عليه RLS (استعلام على `pg_tables` حيث `rowsecurity = false` يرجع صفراً).
- [ ] لا دالة `security definer` بدون `search_path` (استعلام على `pg_proc`).
- [ ] قائمة الدوال القابلة للتنفيذ من `anon`/`authenticated` تطابق SPEC-backend §5 فقط.
- [ ] `service_role` غير موجود بأي حزمة تطبيق أو كود متصفح (بحث بالمستودع وبحزم البناء).
- [ ] اختبار يدوي بـ REST مباشرة (curl بتوكن زبون): قراءة `product_costs`، `stock`، طلبات غيره، تعديل `role`، إدخال طلب مباشر: كلها مرفوضة.
- [ ] الدخول بالهاتف + PIN (ADR 0001): الـ SMS hook يرفض فعلاً على الإنتاج؛ حد الدخول لكل IP مضبوط؛ مراجعة Auth logs لمحاولات تخمين؛ قرار CAPTCHA (Turnstile/hCaptcha) لـ signup/signin؛ قرار قفل لكل حساب (Password Verification Hook بخطة Teams أو دخول عبر Edge Function).
- [ ] `admin-reset-pin`: أدمن فقط، لا لحسابات الأدمن، الحد، سجل التدقيق، الرمز لا يُسجَّل.
- [ ] Storage: لا رفع إلا للأدمن، وحد الحجم والأنواع مفعّل.
- [ ] الأسرار بمتغيرات بيئة Vercel/EAS/Supabase فقط.

## القبول
- كل البنود ✓ وموثقة بـ `docs/ADR/0003-security-review.md`.

## الاختبارات
- تحويل الاستعلامات الثلاثة الأولى لاختبارات pgTAP دائمة.

## الحالة (2026-11-17)
المراجعة (قراءة فقط) منجزة: [docs/reviews/security-T23.md](../reviews/security-T23.md). بنود قائمة الفحص التي فُحصت على
mukhdar-dev ونجحت: RLS على كل جداول `public`، `search_path` لكل الدوال، الدوال القابلة للتنفيذ = القائمة المقصودة (Advisor: 31
تحذيراً مقصوداً، بلا أخطاء)، لا `service_role` بالحزم ولا بتاريخ git، رفض قراءات `anon`، الـ SMS hook وإطفاء التسجيل العام،
`admin-reset-pin` (أدمن فقط، لا لحساب أدمن، الحد، التدقيق، بلا رمز بالسجل)، Storage (أدمن فقط، 512KB، jpeg/webp/png).
الاستعلامات الثلاثة الأولى مغطاة أصلاً بـ `01_schema.sql` و`27_access_matrix.sql`.
**باقٍ قبل ✅:** الإصلاحات بقائمة التقرير (C1 المصادقة الثنائية للأدمن والموظف، H1 CORS للدالتين الإداريتين، H2 حدود الطلب،
H3 تصحيح RUNBOOK §17.4)، وقرارات المالك (CAPTCHA، الاحتفاظ بالبيانات بعد حذف الحساب)، ثم `docs/ADR/0003-security-review.md`.
