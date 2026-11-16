-- مراجعة جلسة الإصلاح AB، جلسة C (docs/reviews/review-fixes-AB.md): H1، M1، وبنود Low بقاعدة البيانات.
--   H1: الإشعارات لا تصل لمن عليه must_change_pin؛ إعادة ضبط الرمز والتعطيل وتخفيض الدور تحذف push_tokens؛
--       register_push_token يرفض الحساب المعلَّم (PIN_CHANGE_REQUIRED).
--   M1: accept_order يقفل صف السائق بشرط الدور والنشاط وعدم العلامة؛ assign_driver يرفض السائق المعلَّم
--       (DRIVER_PIN_PENDING)؛ list_drivers يرجع must_change_pin للوحة.
--   L2: حذف admin_actions_last_hour (بلا استعمال منذ admin_rate_hit).
--   L3: إسناد الطلب لنفس السائق لا يفعل شيئاً (لا إشعار ولا سجل).
--   L4(b): إلغاء بلا إرجاع: بند بلا سجل كلفة يُقيَّم بصفر. (أ): بند منتجه محذوف (product_id null) لا يدخل
--          الهدر؛ مقبول وموثّق بـ SPEC-backend.
--   L5: record_pin_reset: kind = 'admin' يتطلب reset_by، و'break_glass' يمنعه (بالدالة لا بقيد جدول:
--       reset_by يصير null عند حذف الأدمن بـ on delete set null).
-- لا تعديل لـ migration قديمة. الدوال المنسوخة (set_user_role، set_order_status) = آخر نسخة + التعديل أعلاه فقط.

-- ---------------------------------------------------------------------
-- H1.1) claim_push_notifications: بلا مستلمين معلَّمين
-- ---------------------------------------------------------------------
create or replace function public.claim_push_notifications(p_limit int default 200)
returns table (id bigint, title text, body text, data jsonb, attempts int, recipients jsonb)
language sql volatile security invoker set search_path = ''
as $$
  with picked as (
    select o.id
      from public.notification_outbox o
     where o.sent_at is null and o.attempts < 5
       and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
     order by o.created_at, o.id
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
       for update skip locked
  ), claimed as (
    update public.notification_outbox o set claimed_at = now()
      from picked where o.id = picked.id
    returning o.id, o.audience, o.user_id, o.title, o.body, o.data, o.attempts
  )
  select c.id, c.title, c.body, c.data, c.attempts,
         coalesce((select jsonb_agg(jsonb_build_object('token', t.token, 'provider', t.provider,
                                                       'platform', t.platform) order by t.id)
                     from public.push_tokens t
                     join public.profiles p on p.id = t.user_id
                    where p.is_active
                      and not p.must_change_pin   -- H1: رمز مؤقت لم يُغيَّر ← لا إشعارات (جهاز ضائع أو بيد غيره)
                      and case c.audience
                            when 'user'        then t.user_id = c.user_id
                            when 'drivers'     then p.role = 'driver'
                            when 'admins'      then p.role in ('admin', 'staff')
                            when 'admins_only' then p.role = 'admin'
                            else false
                          end), '[]'::jsonb)
    from claimed c
   order by c.id
$$;

-- ---------------------------------------------------------------------
-- H1.2) register_push_token: الحساب المعلَّم لا يسجّل رمزاً (يسجّله بعد تغيير الرمز)
-- ---------------------------------------------------------------------
create or replace function public.register_push_token(
  p_token    text,
  p_platform public.push_platform,
  p_provider public.push_provider default 'expo'
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and must_change_pin) then
    raise exception 'PIN_CHANGE_REQUIRED' using errcode = '42501';
  end if;
  if p_platform is null or p_provider is null
     or nullif(btrim(p_token), '') is null or char_length(p_token) > 255
     or (p_provider = 'expo' and p_token !~ '^Expo(nent)?PushToken\[[^\]]+\]$') then
    raise exception 'INVALID_TOKEN' using errcode = 'P0001';
  end if;
  insert into public.push_tokens (user_id, token, platform, provider)
  values (auth.uid(), p_token, p_platform, p_provider)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, provider = excluded.provider,
        last_seen_at = now();
end
$$;

-- ---------------------------------------------------------------------
-- H1.3 + L5) record_pin_reset: حذف رموز الإشعارات + ربط kind بـ reset_by
-- ---------------------------------------------------------------------
create or replace function public.record_pin_reset(p_user_id uuid, p_reset_by uuid, p_kind text default 'admin')
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_kind not in ('admin', 'break_glass')
     or (p_kind = 'admin') <> (p_reset_by is not null) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  insert into public.pin_resets (user_id, reset_by, kind) values (p_user_id, p_reset_by, p_kind);
  update public.profiles set must_change_pin = true where id = p_user_id;
  -- H1: الإعادة وُجدت لقطع الأجهزة القديمة؛ الجهاز الجديد يسجّل رمزه بعد تغيير الرمز
  delete from public.push_tokens where user_id = p_user_id;
end
$$;

-- ---------------------------------------------------------------------
-- H1.4) set_user_role: نفس نسخة 20261123000001 + حذف push_tokens بفرع الإبطال
-- ---------------------------------------------------------------------
create or replace function public.set_user_role(p_user_id uuid, p_role public.user_role, p_is_active boolean default true)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_old    public.profiles;
  v_orders text;
  v_rank   constant jsonb := '{"customer": 0, "driver": 1, "staff": 2, "admin": 3}';
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_role is null or p_is_active is null then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid and (p_role <> 'admin' or not p_is_active) then
    raise exception 'CANNOT_DEMOTE_SELF' using errcode = 'P0001';
  end if;

  -- تغييرات الأدمن متسلسلة: أدمنان يزيلان بعضهما بنفس اللحظة لا يتركان النظام بلا أدمن.
  perform 1 from public.profiles where role = 'admin' and is_active order by id for update;
  if not exists (select 1 from public.profiles
                  where id = v_uid and role = 'admin' and is_active and not must_change_pin) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- قفل الهدف: accept_order وassign_driver يقفلان ملف السائق for share، فلا يُسند له طلب أثناء تعطيله.
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old.role = p_role and v_old.is_active = p_is_active then
    return;  -- لا تغيير، لا تدقيق
  end if;

  if v_old.role = 'admin' and v_old.is_active and (p_role <> 'admin' or not p_is_active)
     and not exists (select 1 from public.profiles
                      where role = 'admin' and is_active and id <> p_user_id) then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;

  if v_old.role = 'driver' and (p_role <> 'driver' or not p_is_active) then
    select string_agg('#' || o.order_number, '، ' order by o.order_number) into v_orders
      from public.orders o
     where o.driver_id = p_user_id and o.status in ('preparing', 'ready', 'out_for_delivery');
    if v_orders is not null then
      raise exception 'DRIVER_HAS_ORDERS' using errcode = 'P0001', detail = v_orders;
    end if;
  end if;

  update public.profiles set role = p_role, is_active = p_is_active where id = p_user_id;

  insert into public.admin_audit (actor, action, target_id, before, after)
  values (v_uid, 'user_role', p_user_id,
          jsonb_build_object('role', v_old.role, 'is_active', v_old.is_active),
          jsonb_build_object('role', p_role, 'is_active', p_is_active));

  -- التعطيل أو تخفيض الدور: كل الأجهزة تخرج (إعادة التفعيل تتطلب دخولاً جديداً بالرمز).
  -- رمز الوصول الحالي يبقى ≤ ساعة، لكن current_user_role() تقرأ الدور والتفعيل من الجدول فوراً.
  if (v_old.is_active and not p_is_active)
     or (v_rank ->> p_role::text)::int < (v_rank ->> v_old.role::text)::int then
    perform public.revoke_user_sessions(p_user_id);
    -- H1 (جلسة C): ورموز الإشعارات تُحذف أيضاً، وإلا يبقى الجهاز القديم يستلم الإشعارات بعد الخروج
    delete from public.push_tokens where user_id = p_user_id;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- M1.1) accept_order: القفل نفسه يتحقق من الدور والنشاط وعدم العلامة
--       (الفحص قبل القفل لا يكفي: set_user_role قد يخفّض السائق أثناء انتظار القفل)
-- ---------------------------------------------------------------------
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

  -- يتسلسل مع set_user_role وbegin_account_deletion (يقفلان الصف for update): الدور والنشاط والعلامة
  -- تُفحص هنا تحت القفل، فلا يقبل طلباً سائق خُفّض أو عُطّل أثناء الانتظار.
  perform 1 from public.profiles
   where id = v_uid and role = 'driver' and is_active and not must_change_pin for share;
  if not found then
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

-- ---------------------------------------------------------------------
-- M1.2 + L3) assign_driver: سائق بلا علامة، ونفس السائق = لا شيء
-- ---------------------------------------------------------------------
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order       public.orders;
  v_prev_driver uuid;
  v_status      public.order_status;
  v_pending     boolean;
begin
  if not public.is_staff_or_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  -- for share: يتسلسل مع set_user_role (تعطيل السائق أو تخفيضه بنفس اللحظة)
  select must_change_pin into v_pending from public.profiles
   where id = p_driver_id and role = 'driver' and is_active for share;
  if not found then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_pending then
    -- لم يغيّر رمزه المؤقت: لا يقرأ الطلب (RLS) ولا يستلم إشعاراً
    raise exception 'DRIVER_PIN_PENDING' using errcode = 'P0001';
  end if;

  select driver_id, status into v_prev_driver, v_status from public.orders
   where id = p_order_id and status in ('preparing', 'ready', 'out_for_delivery')
   for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if v_prev_driver is not distinct from p_driver_id then
    -- L3: نفس السائق: لا سجل ولا إشعار
    select * into v_order from public.orders where id = p_order_id;
    return v_order;
  end if;

  update public.orders set driver_id = p_driver_id, assigned_at = now()
   where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_status, v_status, auth.uid(),
          case when v_status = 'out_for_delivery' then 'driver_reassigned' else 'driver_assigned' end);

  if v_prev_driver is not null then
    insert into public.admin_audit (actor, action, target_id, before, after)
    values (auth.uid(), 'order_driver', p_order_id,
            jsonb_build_object('driver_id', v_prev_driver, 'status', v_status),
            jsonb_build_object('driver_id', p_driver_id, 'status', v_status));
  end if;

  perform public._notify('user', p_driver_id,
                         case when v_status = 'out_for_delivery'
                              then 'نُقل لك طلب بالطريق #' || v_order.order_number
                              else 'تم تعيين طلب لك #' || v_order.order_number end,
                         'وحدة ' || (v_order.address_snapshot ->> 'subsection') || ' - عمارة ' || (v_order.address_snapshot ->> 'building'),
                         jsonb_build_object('order_id', p_order_id, 'type', 'assigned'));
  perform public._notify('user', v_prev_driver, 'سُحب منك الطلب #' || v_order.order_number,
                         'تم تعيينه لسائق آخر',
                         jsonb_build_object('order_id', p_order_id, 'type', 'unassigned'))
    where v_prev_driver is not null;
  return v_order;
end
$$;

-- ---------------------------------------------------------------------
-- M1.3) list_drivers + must_change_pin (التوقيع تغيّر: drop ثم create)
-- ---------------------------------------------------------------------
drop function public.list_drivers();
create function public.list_drivers()
returns table (id uuid, full_name text, phone text, is_active boolean, must_change_pin boolean)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_staff_or_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.phone, p.is_active, p.must_change_pin
      from public.profiles p
     where p.role = 'driver'
     order by p.is_active desc, p.full_name nulls last, p.id;
end
$$;
revoke all on function public.list_drivers() from public, anon;
grant execute on function public.list_drivers() to authenticated;

-- ---------------------------------------------------------------------
-- L2) admin_actions_last_hour بلا استعمال
-- ---------------------------------------------------------------------
drop function public.admin_actions_last_hour(text, uuid);

-- ---------------------------------------------------------------------
-- L4(b)) set_order_status: نفس نسخة 20261123000001 + coalesce(كلفة الهدر، 0)
-- ---------------------------------------------------------------------
create or replace function public.set_order_status(
  p_order_id     uuid,
  p_status       public.order_status,
  p_reason       text    default null,
  p_return_stock boolean default true
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
  v_return  boolean := coalesce(p_return_stock, true);
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

  -- الإلغاء بلا إرجاع: الأدمن فقط، ولطلب بالطريق فقط (البضاعة طلعت مع السائق)
  if not v_return then
    if p_status <> 'cancelled' or v_prev <> 'out_for_delivery' then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_return_stock';
    end if;
    if v_role <> 'admin' then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
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
    if v_return then
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
    else
      -- البضاعة طلعت مع السائق: الرصيد لا يتغير. السجل يبقى مطابقاً للرصيد (cancel_return + waste بنفس
      -- الكمية)، والهدر بكلفة البنود وقت الطلب (order_item_costs) فيدخل خسائر اليوم وصافي الربح.
      -- L4(b): بند بلا سجل كلفة يُقيَّم بصفر (لا بكلفة اليوم التي يملؤها tg_movement_unit_cost).
      insert into public.inventory_movements (product_id, qty, type, order_id, created_by, note)
      select product_id, sum(qty)::int, 'cancel_return', p_order_id, v_uid, 'إلغاء طلب بعد خروجه (بلا إرجاع)'
        from public.order_items where order_id = p_order_id and product_id is not null
       group by product_id;

      insert into public.inventory_movements (product_id, qty, type, order_id, created_by, note, unit_cost_iqd)
      select i.product_id, -sum(i.qty)::int, 'waste', p_order_id, v_uid,
             'cancelled after dispatch: أُلغي بعد خروجه مع السائق',
             coalesce(round(sum(c.cost_snapshot_iqd * i.qty)::numeric / nullif(sum(i.qty) filter (where c.cost_snapshot_iqd is not null), 0)), 0)::bigint
        from public.order_items i
        left join public.order_item_costs c on c.order_item_id = i.id
       where i.order_id = p_order_id and i.product_id is not null
       group by i.product_id;
    end if;

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

revoke all on function public.set_order_status(uuid, public.order_status, text, boolean) from public, anon;
grant execute on function public.set_order_status(uuid, public.order_status, text, boolean) to authenticated;
