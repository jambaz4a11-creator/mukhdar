-- =====================================================================
-- مراجعة الأمان T23، جلسة الإصلاح E1 (docs/reviews/security-T23.md؛ قرارات المالك 2026-11-17):
--   C1) المصادقة الثنائية (TOTP) إلزامية للأدمن والموظف، وتفرضها قاعدة البيانات لا الواجهة:
--       private.current_user_role() يرجع 'admin'/'staff' فقط لجلسة aal2 (رمز الدخول + رمز تطبيق
--       المصادقة). جلسة aal1 (الـ PIN وحده) = بلا دور، فكل سياسة ودالة مبنية على الدور ترفض (RLS،
--       report_*، dashboard_today، set_order_status، Realtime...). الزبون والسائق بلا تغيير.
--       admin_reset_mfa(p_user_id): الأدمن (aal2) يمسح عوامل المصادقة لموظف (أو أي حساب غير أدمن)،
--       يبطل جلساته، ويسجّل بـ admin_audit ('mfa_reset'). حساب أدمن لا يُمسح من اللوحة (ADMIN_ACCOUNT).
--       break_glass_reset_mfa(p_user_id): service_role فقط (سكربت الطوارئ المحلي): أدمن فقط، نفس الأثر.
--       بريد وسم غير مؤكَّد <phone>@phone.mukhdar.invalid للأدمن والموظف: GoTrue لا يسجّل TOTP بلا بريد.
--   H2) حدود الطلب بقاعدة البيانات، يعدّلها الأدمن (update_app_settings، مُدقَّقة):
--       app_settings.max_line_qty (افتراضي 20 وحدة بيع لكل منتج = 10 كيلو للنص كيلو) و
--       app_settings.max_order_lines (افتراضي 30 منتجاً بالطلب). place_order: QTY_LIMIT / TOO_MANY_ITEMS
--       (detail = الحد).
-- =====================================================================

-- ---------------------------------------------------------------------
-- C1.1) الدور يتطلب aal2 للأدمن والموظف
-- ---------------------------------------------------------------------
create or replace function private.current_user_role()
returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role
    from public.profiles p
   where p.id = auth.uid() and p.is_active and not p.must_change_pin
     and (p.role in ('customer', 'driver')
          or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
$$;
comment on function private.current_user_role() is
  'Role of the caller: active, no temporary PIN, and for admin/staff only with an aal2 (TOTP) session (T23 C1). Null otherwise.';

-- ---------------------------------------------------------------------
-- C1.2) سجل التدقيق: mfa_reset
-- ---------------------------------------------------------------------
alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check
  check (action in ('user_role', 'settings', 'order_driver', 'notifications_dismissed', 'address', 'mfa_reset'));

-- مشترك: يمسح العوامل ويبطل الجلسات ويكتب التدقيق. داخلي (لا تنفيذ لأي دور من الـ API).
create function private.reset_mfa_factors(p_user_id uuid, p_actor uuid, p_via text)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_role public.user_role;
  v_n    integer;
begin
  select role into v_role from public.profiles where id = p_user_id;
  -- auth.mfa_challenges وmfa_amr_claims تُحذف معها (cascade / مع الجلسات)
  delete from auth.mfa_factors where user_id = p_user_id;
  get diagnostics v_n = row_count;
  perform public.revoke_user_sessions(p_user_id);
  insert into public.admin_audit (actor, action, target_id, before, after)
  values (p_actor, 'mfa_reset', p_user_id,
          jsonb_build_object('factors', v_n, 'role', v_role),
          jsonb_build_object('factors', 0, 'via', p_via));
  return v_n;
end
$$;
revoke all on function private.reset_mfa_factors(uuid, uuid, text) from public, anon, authenticated, service_role;

-- الأدمن (aal2) يعيد ضبط المصادقة الثنائية لحساب غير أدمن (موظف فقد هاتفه). يرجع عدد العوامل الممسوحة.
create function public.admin_reset_mfa(p_user_id uuid)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_target public.profiles;
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- حساب أدمن (ولا الأدمن نفسه): سكربت الطوارئ فقط، فلا يأخذ أدمن مخترَق حسابات الأدمن الآخرين
  if v_target.role = 'admin' or p_user_id = v_uid then
    raise exception 'ADMIN_ACCOUNT' using errcode = 'P0001';
  end if;
  return private.reset_mfa_factors(p_user_id, v_uid, 'panel');
end
$$;
comment on function public.admin_reset_mfa(uuid) is
  'Admin (aal2): delete every MFA factor of a non-admin account, revoke its sessions, audit (admin_audit mfa_reset). T23 C1.';
revoke all on function public.admin_reset_mfa(uuid) from public, anon;
grant execute on function public.admin_reset_mfa(uuid) to authenticated;

-- سكربت الطوارئ (service_role): أدمن فقد تطبيق المصادقة. actor = null كـ pin_resets.break_glass.
create function public.break_glass_reset_mfa(p_user_id uuid)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_role <> 'admin' then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'admin accounts only';
  end if;
  return private.reset_mfa_factors(p_user_id, null, 'break_glass');
end
$$;
comment on function public.break_glass_reset_mfa(uuid) is
  'service_role only (pnpm admin:break-glass-reset): delete the MFA factors of an ADMIN account, revoke sessions, audit. T23 C1.';
revoke all on function public.break_glass_reset_mfa(uuid) from public, anon, authenticated;
grant execute on function public.break_glass_reset_mfa(uuid) to service_role;

-- ---------------------------------------------------------------------
-- C1.3) اسم حساب TOTP لحسابات الهاتف
--   GoTrue يبني رابط otpauth:// (رمز QR) من issuer و**بريد** المستخدم (AccountName)، ويرفض التسجيل
--   بـ 500 "Error generating QR Code" لحساب بلا بريد، وكل حساباتنا بالهاتف فقط (فُحص على mukhdar-dev).
--   الحل: بريد **وسم** غير قابل للتسليم لحسابات الأدمن والموظف فقط: <phone>@phone.mukhdar.invalid
--   (.invalid محجوز، RFC 2606: لا يُرسل له شيء أبداً)، **غير مؤكَّد** (email_confirmed_at يبقى null) فلا
--   دخول به (GoTrue يرفض الدخول ببريد غير مؤكَّد، والبريد معطّل أصلاً على الإنتاج، RUNBOOK §6). يظهر
--   فقط كاسم الحساب بتطبيق المصادقة. لا يُمس بريد حقيقي موجود. الزبون والسائق بلا بريد كما هما.
-- ---------------------------------------------------------------------
create function private.ensure_mfa_account_label(p_user_id uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  update auth.users u
     set email = u.phone || '@phone.mukhdar.invalid', updated_at = now()
   where u.id = p_user_id
     and (u.email is null or u.email = '')
     and coalesce(u.phone, '') <> '';
$$;
revoke all on function private.ensure_mfa_account_label(uuid) from public, anon, authenticated, service_role;

create function private.profiles_mfa_label()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if new.role in ('admin', 'staff') then
    perform private.ensure_mfa_account_label(new.id);
  end if;
  return null;
end
$$;
revoke all on function private.profiles_mfa_label() from public, anon, authenticated, service_role;

-- كل طرق صيرورة الحساب أدمن/موظفاً تمر بـ profiles.role (set_user_role، finish_user_creation، SQL المالك)
create trigger profiles_mfa_label
  after insert or update of role on public.profiles
  for each row when (new.role in ('admin', 'staff'))
  execute function private.profiles_mfa_label();

-- الحسابات الحالية
select private.ensure_mfa_account_label(p.id) from public.profiles p where p.role in ('admin', 'staff');

-- ---------------------------------------------------------------------
-- H2.1) حدود الطلب بالإعدادات
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column max_line_qty int not null default 20
    constraint app_settings_max_line_qty_range check (max_line_qty between 1 and 99),
  add column max_order_lines int not null default 30
    constraint app_settings_max_order_lines_range check (max_order_lines between 1 and 50);
comment on column public.app_settings.max_line_qty is
  'Max sale units of one product per order (T23 H2). Default 20 = 10 kg for half-kilo products; same count for bunch/piece units.';
comment on column public.app_settings.max_order_lines is
  'Max distinct products per order (T23 H2). Default 30.';

-- ---------------------------------------------------------------------
-- H2.2) update_app_settings: الحقلان الجديدان (باقي الدالة كما في 20261123000001)
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
    if v_key not in ('delivery_fee_iqd', 'min_order_iqd', 'max_active_orders', 'store_open', 'closed_message',
                     'max_line_qty', 'max_order_lines') then
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

  -- أعداد صحيحة بمدى: max_active_orders 1..1000، max_line_qty 1..99، max_order_lines 1..50
  for v_key, v_num in
    select k, lim from (values ('max_active_orders', 1000::numeric), ('max_line_qty', 99), ('max_order_lines', 50)) t(k, lim)
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

-- ---------------------------------------------------------------------
-- H2.3) place_order: الحدان من الإعدادات (باقي الدالة كما في 20261123000001)
--   - أكثر من 50 عنصراً خاماً بالمصفوفة: TOO_MANY_ITEMS قبل أي تحويل (حد ثابت لحجم الطلب).
--   - بعد دمج المكرر: منتجات > max_order_lines ← TOO_MANY_ITEMS (detail = الحد)؛
--     كمية منتج > max_line_qty ← QTY_LIMIT (detail = الحد). 1..99 لكل عنصر يبقى INVALID_QTY.
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
