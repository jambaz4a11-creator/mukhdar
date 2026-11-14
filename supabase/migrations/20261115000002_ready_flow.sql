-- =====================================================================
-- مسار 'ready' (قرار المالك 2026-11-15):
--   pending ← preparing ← ready ← out_for_delivery ← delivered، والإلغاء:
--     الزبون: من pending فقط؛ الموظف: من pending/preparing/ready؛ الأدمن: أيضاً من out_for_delivery.
--   الموظف/الأدمن: ← preparing، ← ready. السائق (المعيَّن فقط): ready ← out_for_delivery، out_for_delivery ← delivered.
--   الإشعارات: الطلب الجديد للأدمن والموظفين فقط. عند 'ready': الزبون، وكل السائقين النشطين إن لم يكن
--   للطلب سائق (طلب متاح)، أو سائقه فقط إن عُيِّن مسبقاً (افتراض).
--   available_orders / accept_order: طلبات 'ready' غير المعيَّنة فقط. assign_driver: من preparing أو ready.
-- التعريفات منسوخة من آخر نسخة لكل دالة (20261114000001، init، 20261112000004) والتعديل محصور بالمسار.
-- create or replace يحافظ على الصلاحيات الممنوحة سابقاً.
-- =====================================================================

create or replace function public.place_order(
  p_address_id      uuid,
  p_items           jsonb,
  p_idempotency_key uuid,
  p_note            text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles;
  v_settings public.app_settings;
  v_order    public.orders;
  v_address  jsonb;
  v_active   boolean;
  v_ids      uuid[];
  v_qtys     int[];
  v_bad      uuid;
  v_bad_text text;
  v_subtotal bigint;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found or not v_profile.is_active or v_profile.role <> 'customer' then
    raise exception 'NOT_CUSTOMER' using errcode = '42501';
  end if;
  if nullif(btrim(v_profile.phone), '') is null then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  -- قفل لكل زبون: يمنع التكرار بنفس المفتاح، ويجعل عدّ الطلبات النشطة دقيقاً مع التزامن
  perform pg_advisory_xact_lock(hashtextextended('place_order:' || v_uid::text, 0));
  select * into v_order from public.orders
   where customer_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                              'total_iqd', v_order.total_iqd, 'status', v_order.status, 'replayed', true);
  end if;

  select * into v_settings from public.app_settings where id = 1;

  if (select count(*) from public.orders
       where customer_id = v_uid and status in ('pending', 'preparing', 'ready', 'out_for_delivery'))
     >= v_settings.max_active_orders then
    raise exception 'TOO_MANY_ACTIVE_ORDERS' using errcode = 'P0001',
          detail = v_settings.max_active_orders::text;
  end if;

  if not v_settings.store_open then
    raise exception 'STORE_CLOSED' using errcode = 'P0001';
  end if;

  -- العنوان يجب أن يكون للزبون نفسه، ونأخذ نسخة منه للطلب
  select jsonb_build_object(
           'address_id', a.id, 'sector', s.name, 'subsection', ss.name,
           'building', b.number, 'apartment', a.apartment, 'note', a.note),
         b.is_active and ss.is_active and s.is_active
    into v_address, v_active
    from public.addresses a
    join public.buildings   b  on b.id  = a.building_id
    join public.subsections ss on ss.id = b.subsection_id
    join public.sectors     s  on s.id  = ss.sector_id
   where a.id = p_address_id and a.customer_id = v_uid;
  if v_address is null then
    raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not v_active then
    raise exception 'ADDRESS_INACTIVE' using errcode = 'P0001';
  end if;

  -- قراءة السلة: التحقق من الصيغة قبل أي تحويل نوع
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object') then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;

  select left(coalesce(e ->> 'product_id', ''), 64) into v_bad_text
    from jsonb_array_elements(p_items) e
   where jsonb_typeof(e -> 'product_id') is distinct from 'string'
      or (e ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   limit 1;
  if found then
    raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0001', detail = v_bad_text;
  end if;

  if exists (select 1 from jsonb_array_elements(p_items) e
              where jsonb_typeof(e -> 'qty') is distinct from 'number'
                 or (e ->> 'qty') !~ '^[0-9]{1,2}$') then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;

  -- دمج التكرار (الآن التحويل آمن)
  select array_agg(pid order by pid), array_agg(q order by pid)
    into v_ids, v_qtys
    from (select (e ->> 'product_id')::uuid as pid, sum((e ->> 'qty')::int)::int as q
            from jsonb_array_elements(p_items) e
           group by 1) t;

  if exists (select 1 from unnest(v_ids, v_qtys) c(pid, q) where q < 1 or q > 99) then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;

  -- قفل صفوف المخزون بترتيب ثابت (يمنع الـ deadlock ويمنع بيع نفس الحبة مرتين)
  perform 1 from public.stock where product_id = any (v_ids) order by product_id for update;

  select c.pid into v_bad
    from unnest(v_ids, v_qtys) c(pid, q)
    left join public.products p on p.id = c.pid and p.is_active
   where p.id is null
   limit 1;
  if v_bad is not null then
    raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0001', detail = v_bad::text;
  end if;

  select c.pid into v_bad
    from unnest(v_ids, v_qtys) c(pid, q)
    left join public.stock s on s.product_id = c.pid
   where coalesce(s.qty, 0) < c.q
   limit 1;
  if v_bad is not null then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001', detail = v_bad::text;
  end if;

  select public.round_iqd(sum(p.price_iqd * c.q)::bigint) into v_subtotal
    from unnest(v_ids, v_qtys) c(pid, q)
    join public.products p on p.id = c.pid;

  if v_subtotal < v_settings.min_order_iqd then
    raise exception 'BELOW_MIN_ORDER' using errcode = 'P0001', detail = v_settings.min_order_iqd::text;
  end if;

  insert into public.orders (customer_id, address_id, address_snapshot, customer_name, customer_phone,
                             subtotal_iqd, delivery_fee_iqd, total_iqd, note, idempotency_key)
  values (v_uid, p_address_id, v_address, v_profile.full_name, v_profile.phone,
          v_subtotal, v_settings.delivery_fee_iqd, v_subtotal + v_settings.delivery_fee_iqd,
          nullif(trim(p_note), ''), p_idempotency_key)
  returning * into v_order;

  with ins as (
    insert into public.order_items (order_id, product_id, name_snapshot, unit_snapshot,
                                    price_snapshot_iqd, qty, line_total_iqd)
    select v_order.id, p.id, p.name, p.unit, p.price_iqd, c.q, p.price_iqd * c.q
      from unnest(v_ids, v_qtys) c(pid, q)
      join public.products p on p.id = c.pid
    returning id, product_id
  )
  insert into public.order_item_costs (order_item_id, cost_snapshot_iqd)
  select ins.id, coalesce(pc.cost_iqd, 0)
    from ins left join public.product_costs pc on pc.product_id = ins.product_id;

  update public.stock s
     set qty = s.qty - c.q, updated_at = now()
    from unnest(v_ids, v_qtys) c(pid, q)
   where s.product_id = c.pid;

  insert into public.inventory_movements (product_id, qty, type, order_id, created_by)
  select c.pid, -c.q, 'sale', v_order.id, v_uid from unnest(v_ids, v_qtys) c(pid, q);

  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (v_order.id, null, 'pending', v_uid);

  -- الطلب الجديد يُبلَّغ للأدمن والموظفين فقط؛ السائقون يُبلَّغون عند 'ready' (set_order_status)
  perform public._notify('admins', null, 'طلب جديد #' || v_order.order_number,
                         'وحدة ' || (v_address ->> 'subsection') || ' - عمارة ' || (v_address ->> 'building')
                         || ' · المجموع ' || v_order.total_iqd || ' د.ع',
                         jsonb_build_object('order_id', v_order.id, 'type', 'new_order'));

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                            'total_iqd', v_order.total_iqd, 'status', v_order.status, 'replayed', false);
end
$$;

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
    when 'staff'    then p_status in ('preparing', 'ready')
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

create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order       public.orders;
  v_prev_driver uuid;
begin
  if not public.is_staff_or_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_driver_id and role = 'driver' and is_active) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select driver_id into v_prev_driver from public.orders
   where id = p_order_id and status in ('preparing', 'ready')
   for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  update public.orders set driver_id = p_driver_id, assigned_at = now()
   where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_order.status, v_order.status, auth.uid(), 'driver_assigned');
  perform public._notify('user', p_driver_id, 'تم تعيين طلب لك #' || v_order.order_number,
                         'وحدة ' || (v_order.address_snapshot ->> 'subsection') || ' - عمارة ' || (v_order.address_snapshot ->> 'building'),
                         jsonb_build_object('order_id', p_order_id, 'type', 'assigned'));
  perform public._notify('user', v_prev_driver, 'سُحب منك الطلب #' || v_order.order_number,
                         'تم تعيينه لسائق آخر',
                         jsonb_build_object('order_id', p_order_id, 'type', 'unassigned'))
    where v_prev_driver is not null and v_prev_driver <> p_driver_id;
  return v_order;
end
$$;

create or replace function public.available_orders(p_limit int default 20)
returns table (id uuid, order_number bigint, status public.order_status, sector text,
               subsection text, building text, item_count bigint, total_iqd bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.current_user_role() <> 'driver', true) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return query
    select o.id, o.order_number, o.status,
           o.address_snapshot ->> 'sector', o.address_snapshot ->> 'subsection', o.address_snapshot ->> 'building',
           (select sum(i.qty) from public.order_items i where i.order_id = o.id), o.total_iqd, o.created_at
      from public.orders o
     where o.driver_id is null and o.status = 'ready'
     order by o.created_at
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end
$$;

create or replace function public.accept_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders;
begin
  if coalesce(public.current_user_role() <> 'driver', true) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.orders set driver_id = v_uid, assigned_at = now()
   where id = p_order_id and driver_id is null and status = 'ready'
  returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_order.status, v_order.status, v_uid, 'driver_accepted');
  return v_order;
end
$$;

create or replace function public.begin_account_deletion(p_user_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_role      public.user_role;
  v_is_active boolean;
begin
  if p_user_id is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('place_order:' || p_user_id::text, 0));

  select p.role, p.is_active into v_role, v_is_active
    from public.profiles p where p.id = p_user_id
     for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_role = 'admin' then
    raise exception 'ADMIN_ACCOUNT' using errcode = '42501';
  end if;
  if exists (select 1 from public.orders o
              where (o.customer_id = p_user_id or o.driver_id = p_user_id)
                and o.status in ('pending', 'preparing', 'ready', 'out_for_delivery')) then
    raise exception 'ACTIVE_ORDER' using errcode = 'P0001';
  end if;

  update public.profiles set is_active = false where id = p_user_id;
  return v_is_active;
end
$$;

-- فهرس الطلبات المتاحة للسائقين يتبع الحالة الجديدة
drop index if exists public.orders_unassigned_idx;
create index orders_unassigned_idx on public.orders (created_at)
  where driver_id is null and status = 'ready';
