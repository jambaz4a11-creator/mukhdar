-- =====================================================================
-- مراجعة الأمان T23، جلسة الإصلاح E2 (docs/reviews/security-T23.md؛ قرارات المالك 2026-11-17):
--   H2) الحساب الجديد: طلب مفتوح واحد فقط حتى يُسلَّم أول طلب له (app_settings.new_account_max_active_orders = 1)،
--       ثم يسري max_active_orders. admin_cancel_customer_orders(): إلغاء كل الطلبات المفتوحة لزبون + تعطيله (أدمن فقط،
--       مُدقَّق بـ admin_audit 'customer_lockdown'؛ المخزون يرجع إلا لطلب بالطريق فيُسجَّل هدراً).
--   M5) حذف الحساب: الطلبات تبقى للمحاسبة، لكن الاسم والهاتف والعمارة والشقة والملاحظة تُمحى منها ولا يبقى إلا
--       القطاع والوحدة (trigger قبل حذف profiles + تنظيف الطلبات الحالية لمن حُذف سابقاً).
--   M6) الموظف يقرأ الطلبات المفتوحة + طلبات آخر 7 أيام بتوقيت بغداد فقط (سياسة orders_read). الأدمن بلا حد.
--       order_items وorder_status_history وRealtime ترثها (سياساتها exists على orders).
--   M7) جلسة اللوحة: خروج بعد 12 ساعة بلا نشاط، تفرضه قاعدة البيانات: private.panel_sessions + touch_panel_session()
--       (تستدعيها اللوحة والدالتان الإداريتان). current_user_role() ترجع null لجلسة أدمن/موظف خاملة > 12 ساعة، فلا
--       يفيد رمز تحديث مسروق بعد الخمول، ولا مؤقت بالمتصفح.
--   L2) رموز الإشعارات: حد 5 لكل مستخدم (الأقدم يُحذف)، وحذف ما لم يُرَ منذ 60 يوماً بالتنظيف اليومي.
--   L3) تنظيف نصوص المستخدم (bidi، العرض الصفري، التحكم) بـ private.clean_user_text للاسم وملاحظة الطلب
--       وحقول العنوان، وحد 20 عنواناً لكل زبون.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) تنظيف النص (L3)
-- ---------------------------------------------------------------------
-- نفس قواعد rate_order (20261129000001): CR ← LF، حذف التحكم (عدا TAB وLF) وC1 والعرض الصفري وفواصل الأسطر/
-- الفقرات وbidi (U+202A-202E, U+2066-2069)، قص الفراغ، والفارغ يصير null. p_single_line: LF ← مسافة (اسم، شقة).
create function private.clean_user_text(p_text text, p_single_line boolean default false)
returns text
language sql immutable set search_path = ''
as $$
  select nullif(
    btrim(
      case when p_single_line then regexp_replace(c, E'\n', ' ', 'g') else c end,
      E' \t\n'),
    '')
  from (select regexp_replace(
                 regexp_replace(coalesce(p_text, ''), '\r\n?', E'\n', 'g'),
                 '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]', '', 'g') as c) t
$$;
revoke all on function private.clean_user_text(text, boolean) from public, anon, authenticated, service_role;

create function private.tg_clean_profile_name()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.full_name := private.clean_user_text(new.full_name, true);
  return new;
end
$$;
revoke all on function private.tg_clean_profile_name() from public, anon, authenticated, service_role;

create trigger profiles_clean_name
  before insert or update of full_name on public.profiles
  for each row execute function private.tg_clean_profile_name();

create function private.tg_clean_address_text()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_count integer;
begin
  -- الشقة إلزامية: فراغ بعد التنظيف يبقى '' فيرفضه قيد الجدول (23514) كما كان قبل التنظيف
  new.apartment := coalesce(private.clean_user_text(new.apartment, true), '');
  new.note  := private.clean_user_text(new.note);
  new.label := private.clean_user_text(new.label, true);
  if tg_op = 'INSERT' then
    -- حد 20 عنواناً لكل زبون (L3). القفل يمنع تجاوزه بإدخالات متزامنة.
    perform pg_advisory_xact_lock(hashtextextended('addresses:' || new.customer_id::text, 0));
    select count(*) into v_count from public.addresses where customer_id = new.customer_id;
    if v_count >= 20 then
      raise exception 'ADDRESS_LIMIT' using errcode = 'P0001', detail = '20';
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.tg_clean_address_text() from public, anon, authenticated, service_role;

create trigger addresses_clean_text
  before insert or update of apartment, note, label on public.addresses
  for each row execute function private.tg_clean_address_text();

-- ---------------------------------------------------------------------
-- 1) H2: حد الحساب الجديد
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column new_account_max_active_orders int not null default 1
    constraint app_settings_new_account_max_range check (new_account_max_active_orders between 1 and 1000);
comment on column public.app_settings.new_account_max_active_orders is
  'Max open orders for a customer who has no delivered order yet (T23 H2). Default 1; afterwards max_active_orders applies.';

alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check
  check (action in ('user_role', 'settings', 'order_driver', 'notifications_dismissed', 'address', 'mfa_reset',
                    'customer_lockdown'));

-- update_app_settings: المفتاح الجديد (باقي الدالة كما في 20261130000001)
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
    if v_key not in ('delivery_fee_iqd', 'min_order_iqd', 'max_active_orders', 'store_open', 'closed_message',
                     'max_line_qty', 'max_order_lines', 'new_account_max_active_orders') then
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

  -- أعداد صحيحة بمدى: max_active_orders وnew_account_max_active_orders 1..1000، max_line_qty 1..99، max_order_lines 1..50
  for v_key, v_num in
    select k, lim from (values ('max_active_orders', 1000::numeric), ('new_account_max_active_orders', 1000),
                               ('max_line_qty', 99), ('max_order_lines', 50)) t(k, lim)
  loop
    if p ? v_key then
      if jsonb_typeof(p -> v_key) <> 'number'
         or (p ->> v_key)::numeric <> trunc((p ->> v_key)::numeric)
         or (p ->> v_key)::numeric < 1 or (p ->> v_key)::numeric > v_num then
        raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = v_key;
      end if;
    end if;
  end loop;

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

  update public.app_settings set
    delivery_fee_iqd  = case when p ? 'delivery_fee_iqd'  then (p ->> 'delivery_fee_iqd')::numeric::bigint else delivery_fee_iqd end,
    min_order_iqd     = case when p ? 'min_order_iqd'     then (p ->> 'min_order_iqd')::numeric::bigint else min_order_iqd end,
    max_active_orders = case when p ? 'max_active_orders' then (p ->> 'max_active_orders')::numeric::int else max_active_orders end,
    new_account_max_active_orders =
      case when p ? 'new_account_max_active_orders' then (p ->> 'new_account_max_active_orders')::numeric::int
           else new_account_max_active_orders end,
    max_line_qty      = case when p ? 'max_line_qty'      then (p ->> 'max_line_qty')::numeric::int else max_line_qty end,
    max_order_lines   = case when p ? 'max_order_lines'   then (p ->> 'max_order_lines')::numeric::int else max_order_lines end,
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

-- place_order: نسخة 20261130000001 + (أ) الحساب المعطّل يُعاد فحصه بعد القفل (cancel-all قد يعطّله أثناء الانتظار)،
--   (ب) حد الحساب الجديد، (ج) تنظيف ملاحظة الطلب (L3).
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
  v_limit    int;
  v_note     text;
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

  -- (أ) الملف الذي قرأناه قبل القفل قد يكون قديماً: التعطيل (admin_cancel_customer_orders، حذف الحساب) يجري تحت نفس القفل
  perform 1 from public.profiles where id = v_uid and is_active and role = 'customer' and not must_change_pin;
  if not found then
    raise exception 'NOT_CUSTOMER' using errcode = '42501';
  end if;

  select * into v_settings from public.app_settings where id = 1;

  -- (ب) حساب بلا طلب مُسلَّم بعد: حد الحساب الجديد (الأصغر من الحدين دائماً)
  v_limit := v_settings.max_active_orders;
  if not exists (select 1 from public.orders where customer_id = v_uid and status = 'delivered') then
    v_limit := least(v_limit, v_settings.new_account_max_active_orders);
  end if;
  if (select count(*) from public.orders
       where customer_id = v_uid and status in ('pending', 'preparing', 'ready', 'out_for_delivery'))
     >= v_limit then
    raise exception 'TOO_MANY_ACTIVE_ORDERS' using errcode = 'P0001', detail = v_limit::text;
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
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001', detail = v_settings.max_order_lines::text;
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

  -- H2 (T23): حدود الإعدادات بعد الدمج (تكرار نفس المنتج لا يتجاوز حد البند)
  if cardinality(v_ids) > v_settings.max_order_lines then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001', detail = v_settings.max_order_lines::text;
  end if;
  if exists (select 1 from unnest(v_qtys) q where q > v_settings.max_line_qty) then
    raise exception 'QTY_LIMIT' using errcode = 'P0001', detail = v_settings.max_line_qty::text;
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

  -- (ج) ملاحظة الطلب: نص صرف (L3)؛ الطول بعد التنظيف ≤ 300 (قيد الجدول)
  v_note := private.clean_user_text(p_note);

  insert into public.orders (customer_id, address_id, address_snapshot, customer_name, customer_phone,
                             subtotal_iqd, delivery_fee_iqd, total_iqd, note, idempotency_key)
  values (v_uid, p_address_id, v_address, v_profile.full_name, v_profile.phone,
          v_subtotal, v_settings.delivery_fee_iqd, v_subtotal + v_settings.delivery_fee_iqd,
          v_note, p_idempotency_key)
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

-- ---------------------------------------------------------------------
-- 2) H2: "إلغاء كل الطلبات المفتوحة + تعطيل" لزبون (أدمن فقط)
-- ---------------------------------------------------------------------
create function public.admin_cancel_customer_orders(p_user_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_target   public.profiles;
  v_order    record;
  v_cancel   int := 0;
  v_dispatch int := 0;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- نفس قفل place_order: لا طلب يُنشأ بين الإلغاء والتعطيل
  perform pg_advisory_xact_lock(hashtextextended('place_order:' || p_user_id::text, 0));

  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- للزبائن فقط: السائق له مسار نقل الطلبات، والموظف والأدمن من set_user_role
  if v_target.role <> 'customer' then
    raise exception 'NOT_A_CUSTOMER' using errcode = 'P0001';
  end if;

  -- تعطيل أولاً (مع إبطال الجلسات وحذف رموز الإشعارات): مثل أي تعطيل (set_user_role، يدقّق 'user_role')
  perform public.set_user_role(p_user_id, 'customer', false);

  -- ثم الإلغاء بنفس مسار set_order_status (يرجع المخزون، يبلّغ، يحدّث الإحصاء). طلب بالطريق: البضاعة طلعت مع
  -- السائق، فلا إرجاع وتُسجَّل هدراً بكلفة الطلب (نفس قاعدة "الإلغاء بلا إرجاع").
  for v_order in
    select id, status from public.orders
     where customer_id = p_user_id and status in ('pending', 'preparing', 'ready', 'out_for_delivery')
     order by created_at
     for update
  loop
    perform public.set_order_status(v_order.id, 'cancelled', 'إلغاء من الأدمن: حساب موقوف',
                                    v_order.status <> 'out_for_delivery');
    v_cancel := v_cancel + 1;
    if v_order.status = 'out_for_delivery' then v_dispatch := v_dispatch + 1; end if;
  end loop;

  insert into public.admin_audit (actor, action, target_id, before, after)
  values (v_uid, 'customer_lockdown', p_user_id,
          jsonb_build_object('is_active', v_target.is_active, 'open_orders', v_cancel),
          jsonb_build_object('is_active', false, 'cancelled', v_cancel, 'cancelled_out_for_delivery', v_dispatch));

  return jsonb_build_object('cancelled', v_cancel, 'out_for_delivery', v_dispatch);
end
$$;
comment on function public.admin_cancel_customer_orders(uuid) is
  'Admin only: cancel every open order of a customer (stock returned unless out_for_delivery → waste) and deactivate the account (sessions revoked). Audited as customer_lockdown. T23 H2.';
revoke all on function public.admin_cancel_customer_orders(uuid) from public, anon;
grant execute on function public.admin_cancel_customer_orders(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3) M5: حذف الحساب يمحو بيانات الهوية من طلباته
-- ---------------------------------------------------------------------
-- يبقى بالطلب: المبالغ والبنود والتواريخ والقطاع والوحدة. يُمحى: الاسم، الهاتف، العمارة، الشقة، ملاحظة العنوان،
-- ملاحظة الطلب، ومعرّف العنوان. (before delete: قيود FK الخاصة بـ set null تعمل بعده، فالطلبات ما زالت مرتبطة.)
create function private.anonymize_customer_orders(p_customer_id uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.orders o
     set customer_name = null,
         customer_phone = null,
         note = null,
         address_snapshot = jsonb_strip_nulls(jsonb_build_object(
           'sector', o.address_snapshot -> 'sector', 'subsection', o.address_snapshot -> 'subsection'))
   where o.customer_id = p_customer_id;
$$;
revoke all on function private.anonymize_customer_orders(uuid) from public, anon, authenticated, service_role;

create function private.tg_profiles_anonymize_orders()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform private.anonymize_customer_orders(old.id);
  return old;
end
$$;
revoke all on function private.tg_profiles_anonymize_orders() from public, anon, authenticated, service_role;

create trigger profiles_anonymize_orders
  before delete on public.profiles
  for each row execute function private.tg_profiles_anonymize_orders();

-- من حُذفت حساباتهم قبل هذا التغيير: أي طلب بلا زبون (customer_id null) لا يُبقي هوية
update public.orders o
   set customer_name = null,
       customer_phone = null,
       note = null,
       address_snapshot = jsonb_strip_nulls(jsonb_build_object(
         'sector', o.address_snapshot -> 'sector', 'subsection', o.address_snapshot -> 'subsection'))
 where o.customer_id is null
   and (o.customer_name is not null or o.customer_phone is not null or o.note is not null
        or o.address_snapshot ? 'building' or o.address_snapshot ? 'apartment'
        or o.address_snapshot ? 'note' or o.address_snapshot ? 'address_id');

-- ---------------------------------------------------------------------
-- 4) M6: الموظف: الطلبات المفتوحة + آخر 7 أيام بتوقيت بغداد
-- ---------------------------------------------------------------------
-- "آخر 7 أيام" = اليوم + 6 أيام قبله (حدود يوم بغداد). الأدمن بلا حد. الزبون والسائق كما كانا.
-- (baghdad_today() متاحة لـ anon أصلاً، فلا دالة جديدة بـ private قابلة للتنفيذ.)
drop policy orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using (
  customer_id = (select auth.uid())
  or (driver_id = (select auth.uid()) and (select private.current_user_role()) = 'driver')
  or (select private.is_admin())
  or ((select private.is_staff_or_admin())
      and (status in ('pending', 'preparing', 'ready', 'out_for_delivery')
           or created_at >= (((select public.baghdad_today()) - 6)::timestamp at time zone 'Asia/Baghdad'))));

-- ---------------------------------------------------------------------
-- 5) M7: خمول جلسة اللوحة 12 ساعة (يفرضه الخادم)
-- ---------------------------------------------------------------------
create table private.panel_sessions (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  last_seen  timestamptz not null default now()
);
alter table private.panel_sessions enable row level security;
revoke all on private.panel_sessions from public, anon, authenticated;
comment on table private.panel_sessions is
  'Last activity of admin/staff panel sessions (T23 M7). Row dies with its auth session. A row older than 12 h = expired session.';

-- current_user_role: نسخة 20261130000001 + جلسة أدمن/موظف خاملة > 12 ساعة = بلا دور.
-- لا صف بجدولنا (جلسة لم تلمس اللوحة بعد، مثل سكربت/اختبار) ← لا قيد؛ كل جلسة لوحة لها صف من أول طلب.
create or replace function private.current_user_role()
returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role
    from public.profiles p
   where p.id = auth.uid() and p.is_active and not p.must_change_pin
     and (p.role in ('customer', 'driver')
          or (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
              and not exists (select 1 from private.panel_sessions s
                               where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
                                 and s.last_seen < now() - interval '12 hours')))
$$;
comment on function private.current_user_role() is
  'Role of the caller: active, no temporary PIN, and for admin/staff only with an aal2 (TOTP) session that was not idle for 12 h (T23 C1, M7). Null otherwise.';

-- تسجيل نشاط (تستدعيها اللوحة بكل تنقّل، والدالتان الإداريتان بكل طلب). true = الجلسة حيّة؛ false = انتهت بالخمول
-- وحُذفت (يخرج الجهاز). لا تُحيي جلسة منتهية أبداً. للزبون والسائق وجلسة بلا session_id: true بلا تتبع.
create function public.touch_panel_session()
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_sid  uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_role public.user_role;
  v_last timestamptz;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select role into v_role from public.profiles where id = v_uid and is_active;
  if v_sid is null or v_role is null or v_role not in ('admin', 'staff') then
    return true;
  end if;
  -- الجلسة يجب أن تكون موجودة بـ Auth (FK)؛ غير ذلك (حُذفت للتو) = منتهية
  perform 1 from auth.sessions where id = v_sid;
  if not found then
    return false;
  end if;

  select last_seen into v_last from private.panel_sessions where session_id = v_sid for update;
  if not found then
    insert into private.panel_sessions (session_id, user_id) values (v_sid, v_uid)
    on conflict (session_id) do nothing;
    return true;
  end if;
  if v_last < now() - interval '12 hours' then
    delete from auth.sessions where id = v_sid;   -- يحذف رموز التحديث ويصفّر هذا الصف (cascade)
    return false;
  end if;
  if v_last < now() - interval '1 minute' then
    update private.panel_sessions set last_seen = now() where session_id = v_sid;
  end if;
  return true;
end
$$;
comment on function public.touch_panel_session() is
  'Panel/admin-function activity ping (T23 M7): true = session alive, false = idle > 12 h (session deleted). Never revives an expired session.';
revoke all on function public.touch_panel_session() from public, anon;
grant execute on function public.touch_panel_session() to authenticated;

-- ---------------------------------------------------------------------
-- 6) L2: رموز الإشعارات: حد 5 لكل مستخدم، وحذف الراكد
-- ---------------------------------------------------------------------
-- نسخة 20261125000001 + الحد. نقل رمز معروف لحساب آخر (on conflict) يبقى (أجهزة مشتركة).
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

  -- L2: أحدث 5 رموز فقط لكل مستخدم (الأقدم نشاطاً يُحذف)
  delete from public.push_tokens t
   where t.user_id = auth.uid()
     and t.id in (select id from public.push_tokens
                   where user_id = auth.uid()
                   order by last_seen_at desc, id desc
                   offset 5);
end
$$;

create or replace function private.purge_push_history()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  delete from public.notification_outbox
   where created_at < now() - interval '30 days'
     and (sent_at is not null or attempts >= 5);
  -- L2: جهاز لم يُرَ منذ 60 يوماً (التطبيق يجدد last_seen_at عند كل تشغيل)
  delete from public.push_tokens where last_seen_at < now() - interval '60 days';
end
$$;
