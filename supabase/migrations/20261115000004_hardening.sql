-- =====================================================================
-- تقوية (مراجعة 2026-11-14: S3، S7)
--   S3: الكتابة على push_tokens عبر register_push_token فقط (التحقق من صيغة Expo والمزوّد).
--       التطبيق يبقى يقرأ رموزه ويحذفها (تسجيل الخروج).
--   S7: وحدات البيع قائمة ثابتة (مطابقة لـ SALE_UNITS بـ packages/shared ولوحدات seed.sql).
--       إضافة وحدة لاحقاً = migration جديد يعدّل القيد + تحديث SALE_UNITS.
--       order_items.unit_snapshot بلا قيد: نسخة تاريخية لما كان وقت الطلب.
-- =====================================================================
revoke insert, update on public.push_tokens from authenticated;

alter table public.products add constraint products_unit_allowed
  check (unit in ('نص كيلو', 'باقة', 'حبة', 'علبة', 'قنينة', 'سلة'));
