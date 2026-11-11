-- سائق معطّل لا يقرأ أي طلب، حتى الطلبات المعيَّنة له مسبقاً (فيها هاتف الزبون وعنوانه).
-- private.current_user_role() ترجع null لحساب معطّل، فشرط "دوره driver" يكفي.
-- order_items و order_status_history ترث هذا تلقائياً (سياستاهما exists على orders)،
-- وكذلك Realtime (يطبّق RLS على كل حدث).
drop policy orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using (
  customer_id = (select auth.uid())
  or (driver_id = (select auth.uid()) and (select private.current_user_role()) = 'driver')
  or (select private.is_staff_or_admin()));
