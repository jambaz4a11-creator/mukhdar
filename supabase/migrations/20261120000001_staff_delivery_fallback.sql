-- إجراءات احتياطية للتوصيل (2026-11-16، قرار المالك): تطبيق السائق خارجي ولم يُربط بعد، فلا أحد يستطيع
-- تحريك الطلب بعد "جاهز". الموظف (كالأدمن) يستطيع الآن: ready -> out_for_delivery (يتطلب سائقاً معيَّناً،
-- NO_DRIVER_ASSIGNED كما هو) و out_for_delivery -> delivered. الإلغاء من out_for_delivery يبقى للأدمن وحده.
-- باقي الدالة كما في 20261115000002_ready_flow.sql بلا تغيير (الصلاحيات تبقى: create or replace يحفظها).

create or replace function public.set_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_reason   text default null
)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role := public.current_user_role();
  v_order   public.orders;
  v_prev    public.order_status;
  v_allowed boolean;
  v_cost    bigint;
  v_reason  text := left(nullif(trim(p_reason), ''), 300);
begin
  if v_uid is null or v_role is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_prev := v_order.status;

  if not ((v_prev = 'pending'          and p_status in ('preparing', 'cancelled'))
       or (v_prev = 'preparing'        and p_status in ('ready', 'cancelled'))
       or (v_prev = 'ready'            and p_status in ('out_for_delivery', 'cancelled'))
       or (v_prev = 'out_for_delivery' and p_status in ('delivered', 'cancelled'))) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
          detail = v_prev::text || ' -> ' || p_status::text;
  end if;

  v_allowed := case v_role
    when 'admin'    then true
    -- الموظف أيضاً بالطريق/تم التوصيل: إجراءات احتياطية (تطبيق السائق معطّل أو السائق نسي)
    when 'staff'    then p_status in ('preparing', 'ready', 'out_for_delivery', 'delivered')
                         or (p_status = 'cancelled' and v_prev in ('pending', 'preparing', 'ready'))
    when 'driver'   then v_order.driver_id = v_uid and p_status in ('out_for_delivery', 'delivered')
    when 'customer' then v_order.customer_id = v_uid and v_prev = 'pending' and p_status = 'cancelled'
    else false
  end;
  if not coalesce(v_allowed, false) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_status = 'out_for_delivery' and v_order.driver_id is null then
    raise exception 'NO_DRIVER_ASSIGNED' using errcode = 'P0001';
  end if;

  update public.orders set
    status              = p_status,
    preparing_at        = case when p_status = 'preparing'        then now() else preparing_at end,
    ready_at            = case when p_status = 'ready'            then now() else ready_at end,
    out_for_delivery_at = case when p_status = 'out_for_delivery' then now() else out_for_delivery_at end,
    delivered_at        = case when p_status = 'delivered'        then now() else delivered_at end,
    cancelled_at        = case when p_status = 'cancelled'        then now() else cancelled_at end,
    cancelled_by        = case when p_status = 'cancelled'        then v_uid else cancelled_by end,
    cancel_reason       = case when p_status = 'cancelled'        then v_reason else cancel_reason end
  where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_prev, p_status, v_uid, v_reason);

  if p_status = 'cancelled' then
    -- إرجاع المخزون (قفل بنفس الترتيب الثابت)
    perform 1 from public.stock
     where product_id in (select product_id from public.order_items where order_id = p_order_id)
     order by product_id for update;

    update public.stock s
       set qty = s.qty + oi.qty, updated_at = now()
      from (select product_id, sum(qty)::int as qty from public.order_items
             where order_id = p_order_id and product_id is not null group by product_id) oi
     where s.product_id = oi.product_id;

    insert into public.inventory_movements (product_id, qty, type, order_id, created_by, note)
    select product_id, sum(qty)::int, 'cancel_return', p_order_id, v_uid, 'إلغاء طلب'
      from public.order_items where order_id = p_order_id and product_id is not null
     group by product_id;

    perform public._bump_daily_stats(public.baghdad_today(), 0, 1, 0, 0, 0);
    perform public._notify('user', v_order.customer_id, 'تم إلغاء طلبك',
                           'الطلب #' || v_order.order_number,
                           jsonb_build_object('order_id', p_order_id, 'status', p_status))
      where v_order.customer_id is not null;
    -- السائق المعيَّن (إن لم يكن هو من ألغى) يعرف أن الطلب أُلغي
    perform public._notify('user', v_order.driver_id, 'تم إلغاء الطلب #' || v_order.order_number,
                           coalesce(v_reason, 'وحدة ' || (v_order.address_snapshot ->> 'subsection') || ' - عمارة ' || (v_order.address_snapshot ->> 'building')),
                           jsonb_build_object('order_id', p_order_id, 'type', 'cancelled', 'status', p_status))
      where v_order.driver_id is not null and v_order.driver_id <> v_uid;

  elsif p_status = 'delivered' then
    select coalesce(sum(c.cost_snapshot_iqd * i.qty), 0)::bigint into v_cost
      from public.order_items i join public.order_item_costs c on c.order_item_id = i.id
     where i.order_id = p_order_id;

    perform public._bump_daily_stats(public.baghdad_today(), 1, 0,
                                     v_order.subtotal_iqd, v_order.delivery_fee_iqd, v_cost);
    perform public._notify('user', v_order.customer_id, 'تم توصيل طلبك',
                           'شكراً لك! قيّم طلبك #' || v_order.order_number,
                           jsonb_build_object('order_id', p_order_id, 'status', p_status))
      where v_order.customer_id is not null;

  else
    perform public._notify('user', v_order.customer_id,
                           case p_status when 'preparing' then 'طلبك قيد التحضير'
                                         when 'ready'     then 'طلبك جاهز، بانتظار السائق'
                                         else 'طلبك بالطريق إليك' end,
                           'الطلب #' || v_order.order_number,
                           jsonb_build_object('order_id', p_order_id, 'status', p_status))
      where v_order.customer_id is not null;

    if p_status = 'ready' then
      -- غير معيَّن ← كل السائقين النشطين (طلب جديد متاح)؛ معيَّن مسبقاً ← سائقه فقط
      perform public._notify('drivers', null, 'طلب جديد #' || v_order.order_number,
                             'وحدة ' || (v_order.address_snapshot ->> 'subsection') || ' - عمارة ' || (v_order.address_snapshot ->> 'building'),
                             jsonb_build_object('order_id', p_order_id, 'type', 'new_order'))
        where v_order.driver_id is null;
      perform public._notify('user', v_order.driver_id, 'الطلب #' || v_order.order_number || ' جاهز للاستلام',
                             'وحدة ' || (v_order.address_snapshot ->> 'subsection') || ' - عمارة ' || (v_order.address_snapshot ->> 'building'),
                             jsonb_build_object('order_id', p_order_id, 'type', 'ready'))
        where v_order.driver_id is not null;
    end if;
  end if;

  return v_order;
end
$$;
