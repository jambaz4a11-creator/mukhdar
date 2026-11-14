-- =====================================================================
-- حالة جديدة 'ready' (قرار المالك 2026-11-15): pending ← preparing ← ready ← out_for_delivery ← delivered
-- قيمة الـ enum بملف مستقل: Postgres لا يسمح باستخدام قيمة enum جديدة داخل نفس المعاملة التي أضافتها،
-- والدوال والفهرس الجزئي الذي يستخدمها بـ 20261115000002_ready_flow.sql.
-- =====================================================================
alter type public.order_status add value if not exists 'ready' after 'preparing';

alter table public.orders add column ready_at timestamptz;
