-- =====================================================================
-- مراجعة T16-T19، جلسة الإصلاح A (docs/reviews/review-T16-T19.md: H1، H2، M1، M3؛ قرارات المالك 2026-11-16):
--   1) تغيير الرمز المؤقت إجباري: profiles.must_change_pin. تضبطه admin-create-user وadmin-reset-pin عبر
--      دوالهما الموجودة (finish_user_creation، record_pin_reset: بلا إعادة نشر)، ويُمسح تلقائياً حين تتغير
--      كلمة السر فعلاً (trigger على auth.users)، فلا يكفي استدعاء من التطبيق لمسحه.
--      أثناءه: current_user_role() = null، فكل دالة وسياسة مبنية على الدور ترفض، وplace_order ترفض
--      PIN_CHANGE_REQUIRED. الملف الشخصي والعناوين (صفوف الشخص نفسه) وتغيير الرمز (GoTrue) وحذف الحساب تبقى.
--   2) سجل تدقيق admin_audit: الأدوار والتفعيل والإعدادات وتغيير سائق الطلب (من، متى، القديم ← الجديد).
--   3) set_user_role: لا يُزال آخر أدمن نشط (LAST_ADMIN)؛ سائق عنده طلبات لم تنتهِ لا يُعطَّل ولا يُغيَّر
--      دوره (DRIVER_HAS_ORDERS، التفصيل = أرقام الطلبات)؛ التعطيل أو تخفيض الدور يبطل كل الجلسات.
--   4) assign_driver: يقبل out_for_delivery أيضاً (نقل الطلب لسائق نشط آخر، للأدمن والموظف كإجراءات التوصيل
--      الاحتياطية)، ويُسجَّل.
--   5) set_order_status(..., p_return_stock default true): الأدمن يلغي طلباً بالطريق بلا إرجاع للمخزون؛
--      الكمية تُسجَّل هدراً ("cancelled after dispatch") بكلفة الطلب، فيبقى صافي الربح صحيحاً.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) must_change_pin
-- ---------------------------------------------------------------------
alter table public.profiles add column must_change_pin boolean not null default false;
comment on column public.profiles.must_change_pin is
  'true after admin-create-user / admin-reset-pin (temporary PIN). Cleared by a real password change (trigger on auth.users). While true, current_user_role() is null.';
-- المستخدم لا يعدّله: صلاحية update على profiles للعمود full_name فقط (كما هي).

create or replace function private.current_user_role()
returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active and not must_change_pin
$$;

-- تغيير كلمة السر فعلاً (updateUser من التطبيق، أو SQL الطوارئ) يمسح العلامة. إعادة الضبط من الأدمن
-- تغيّرها أيضاً، لكن record_pin_reset يضبط العلامة بعدها (admin-reset-pin: الرمز ← الجلسات ← التدقيق).
create function public.tg_auth_pin_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set must_change_pin = false where id = new.id and must_change_pin;
  return null;
end
$$;
revoke all on function public.tg_auth_pin_changed() from public, anon, authenticated;

create trigger on_auth_user_password_changed after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.tg_auth_pin_changed();

create or replace function public.record_pin_reset(p_user_id uuid, p_reset_by uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  insert into public.pin_resets (user_id, reset_by) values (p_user_id, p_reset_by);
  update public.profiles set must_change_pin = true where id = p_user_id;
$$;

create or replace function public.finish_user_creation(p_user_id uuid, p_created_by uuid,
                                                       p_role public.user_role, p_full_name text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_role not in ('staff', 'driver') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  update public.profiles
     set role = p_role, is_active = true, full_name = nullif(btrim(p_full_name), ''), must_change_pin = true
   where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into public.user_creations (user_id, created_by, role) values (p_user_id, p_created_by, p_role);
end
$$;

-- ---------------------------------------------------------------------
-- 2) admin_audit
-- ---------------------------------------------------------------------
create table public.admin_audit (
  id         bigint generated always as identity primary key,
  actor      uuid references public.profiles (id) on delete set null,
  action     text not null check (action in ('user_role', 'settings', 'order_driver')),
  target_id  uuid,                     -- المستخدم (user_role) أو الطلب (order_driver)؛ null للإعدادات
  before     jsonb not null default '{}'::jsonb,
  after      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.admin_audit is
  'Who changed what (review T16-T19 M3): roles/active (set_user_role), settings (update_app_settings), order driver (assign_driver). Admin read only; written by those functions only.';
create index admin_audit_created_idx on public.admin_audit (created_at desc);
create index admin_audit_target_idx on public.admin_audit (target_id) where target_id is not null;
create index admin_audit_actor_idx on public.admin_audit (actor);

alter table public.admin_audit enable row level security;
create policy admin_audit_admin_read on public.admin_audit for select to authenticated
  using ((select private.is_admin()));
revoke all on public.admin_audit from public, anon, authenticated, service_role;
grant select on public.admin_audit to authenticated;

-- ---------------------------------------------------------------------
-- 3) set_user_role
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
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3b) update_app_settings + تدقيق (باقي الدالة كما في 20261122000001)
-- ---------------------------------------------------------------------
create or replace function public.update_app_settings(p jsonb)
returns public.app_settings
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row    public.app_settings;
  v_old    public.app_settings;
  v_key    text;
  v_num    numeric;
  v_msg    text;
  v_before jsonb;
  v_after  jsonb;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'INVALID_SETTINGS' using errcode = 'P0001';
  end if;

  for v_key in select jsonb_object_keys(p) loop
    if v_key not in ('delivery_fee_iqd', 'min_order_iqd', 'max_active_orders', 'store_open', 'closed_message') then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;

  select * into v_old from public.app_settings where id = 1 for update;

  foreach v_key in array array['delivery_fee_iqd', 'min_order_iqd'] loop
    if p ? v_key then
      if jsonb_typeof(p -> v_key) <> 'number' then
        raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = v_key;
      end if;
      v_num := (p ->> v_key)::numeric;
      if v_num <> trunc(v_num) or v_num < 0 or v_num > 10000000 or v_num % 250 <> 0 then
        raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = v_key;
      end if;
    end if;
  end loop;

  if p ? 'max_active_orders' then
    if jsonb_typeof(p -> 'max_active_orders') <> 'number' then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = 'max_active_orders';
    end if;
    v_num := (p ->> 'max_active_orders')::numeric;
    if v_num <> trunc(v_num) or v_num < 1 or v_num > 1000 then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = 'max_active_orders';
    end if;
  end if;

  if p ? 'store_open' and jsonb_typeof(p -> 'store_open') <> 'boolean' then
    raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = 'store_open';
  end if;

  if p ? 'closed_message' then
    if jsonb_typeof(p -> 'closed_message') not in ('string', 'null') then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = 'closed_message';
    end if;
    v_msg := nullif(btrim(p ->> 'closed_message'), '');
    if char_length(v_msg) > 200 then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = 'closed_message';
    end if;
  end if;

  -- (مراجعة L1) القيمة المتحقق منها كرقم، فـ 1000.0 لا يسقط بخطأ تحويل نصي
  update public.app_settings set
    delivery_fee_iqd  = case when p ? 'delivery_fee_iqd'  then (p ->> 'delivery_fee_iqd')::numeric::bigint else delivery_fee_iqd end,
    min_order_iqd     = case when p ? 'min_order_iqd'     then (p ->> 'min_order_iqd')::numeric::bigint else min_order_iqd end,
    max_active_orders = case when p ? 'max_active_orders' then (p ->> 'max_active_orders')::numeric::int else max_active_orders end,
    store_open        = case when p ? 'store_open'        then (p ->> 'store_open')::boolean else store_open end,
    closed_message    = case when p ? 'closed_message'    then v_msg else closed_message end
  where id = 1
  returning * into v_row;

  -- التدقيق: الحقول التي تغيّرت فعلاً فقط
  select jsonb_object_agg(k, to_jsonb(v_old) -> k), jsonb_object_agg(k, to_jsonb(v_row) -> k)
    into v_before, v_after
    from jsonb_object_keys(p) k
   where (to_jsonb(v_old) -> k) is distinct from (to_jsonb(v_row) -> k);
  if v_before is not null then
    insert into public.admin_audit (actor, action, before, after)
    values (auth.uid(), 'settings', v_before, v_after);
  end if;
  return v_row;
end
$$;

-- ---------------------------------------------------------------------
-- 4) assign_driver: preparing / ready / out_for_delivery
-- ---------------------------------------------------------------------
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order       public.orders;
  v_prev_driver uuid;
  v_status      public.order_status;
begin
  if not public.is_staff_or_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  -- for share: يتسلسل مع set_user_role (تعطيل السائق نفسه بنفس اللحظة)
  perform 1 from public.profiles where id = p_driver_id and role = 'driver' and is_active for share;
  if not found then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select driver_id, status into v_prev_driver, v_status from public.orders
   where id = p_order_id and status in ('preparing', 'ready', 'out_for_delivery')
   for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  update public.orders set driver_id = p_driver_id, assigned_at = now()
   where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_status, v_status, auth.uid(),
          case when v_status = 'out_for_delivery' then 'driver_reassigned' else 'driver_assigned' end);

  if v_prev_driver is not null and v_prev_driver <> p_driver_id then
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
    where v_prev_driver is not null and v_prev_driver <> p_driver_id;
  return v_order;
end
$$;

-- ---------------------------------------------------------------------
-- 5) set_order_status + p_return_stock (التوقيع تغيّر: drop ثم create، والصلاحية من جديد)
--    باقي الدالة كما في 20261120000001_staff_delivery_fallback.sql
-- ---------------------------------------------------------------------
drop function public.set_order_status(uuid, public.order_status, text);

create function public.set_order_status(
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
      insert into public.inventory_movements (product_id, qty, type, order_id, created_by, note)
      select product_id, sum(qty)::int, 'cancel_return', p_order_id, v_uid, 'إلغاء طلب بعد خروجه (بلا إرجاع)'
        from public.order_items where order_id = p_order_id and product_id is not null
       group by product_id;

      insert into public.inventory_movements (product_id, qty, type, order_id, created_by, note, unit_cost_iqd)
      select i.product_id, -sum(i.qty)::int, 'waste', p_order_id, v_uid,
             'cancelled after dispatch: أُلغي بعد خروجه مع السائق',
             round(sum(c.cost_snapshot_iqd * i.qty)::numeric / nullif(sum(i.qty) filter (where c.cost_snapshot_iqd is not null), 0))::bigint
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

-- ---------------------------------------------------------------------
-- 6) place_order: رمز مؤقت ← PIN_CHANGE_REQUIRED (باقي الدالة بلا تغيير، أدناه)
-- ---------------------------------------------------------------------
create or replace function public.place_order(p_address_id uuid, p_items jsonb, p_idempotency_key uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if v_profile.must_change_pin then
    raise exception 'PIN_CHANGE_REQUIRED' using errcode = '42501';
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
$function$;
