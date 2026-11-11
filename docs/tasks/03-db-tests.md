# 03: اختبارات قاعدة البيانات (pgTAP) ✅

**الهدف:** تغطية كل دالة وكل سياسة RLS بـ SPEC-backend §5 و§10.

## الخطوات
- `supabase/tests/` بملفات مرقمة: `01_schema.sql`، `02_rls_catalog.sql`، `03_place_order.sql`، `04_status_transitions.sql`، `05_driver.sql`، `06_stock.sql`، `07_ratings.sql`، `08_roles.sql`.
- دالة مساعدة للاختبار `tests.as_user(uuid)` تضبط `role authenticated` و`request.jwt.claims`.
- تشغيل: `supabase test db --linked` (أو عبر جلسة سحابية بـ Docker إن احتجت محلياً).
- إضافتها لـ CI.

## الحالات الإلزامية
- `place_order`: السعر من الجدول، دمج المكرر، 0 و100 مرفوضة، رصيد غير كافٍ، منتج معطّل، عنوان شخص آخر، متجر مغلق، حد أدنى، منع التكرار.
- التحويلات: كل خلية بجدول الأدوار (مسموح وممنوع)، `NO_DRIVER_ASSIGNED`، الحالات النهائية.
- الإلغاء يرجع المخزون؛ التسليم يحدّث `daily_stats` بالأرقام الصحيحة.
- RLS: زبون لا يرى `product_costs`/`stock`/طلبات غيره؛ سائق لا يرى طلباً غير معيَّن؛ `available_orders` بلا هاتف؛ `anon` كتالوج فقط؛ زبون لا يغيّر دوره؛ إدخال طلب مباشر مرفوض.
- `accept_order`: الثاني يفشل.

## القبول
- كل الاختبارات تمر بـ CI. أي تعديل لاحق للمخطط يأتي مع اختباره.

## ما نُفّذ (2026-11-11)
- 8 ملفات بـ `supabase/tests/` (253 فحصاً) + `_helpers.sql` (`tests.as_user` وأخواتها ودوال التجهيز). كل الحالات الإلزامية أعلاه مغطاة، وجدول الأدوار كاملاً (6 أدوار × 6 تحويلات).
- التشغيل: `pnpm db:test:remote` (السحابة) أو `pnpm db:test` (محلي/CI) عبر `scripts/db-test.mjs` بدل `supabase test db --linked` (يحتاج Docker). التفاصيل بـ RUNBOOK §8.
- إضافة (بموافقة صاحب المشروع): migration `20261111000001_advisor_fixes.sql` تصلح تحذيرات Advisor من T02. المتبقي 9 تحذيرات مقصودة فقط (RPC).
- CI: وظيفة `db-tests` تشغّل `supabase start` على runner GitHub وتختبر عليه.
