-- تسليم الكاش من السائق للمتجر (T40، SPEC-cash §2 و§3 K1–K19، قرارات المالك 2026-11-22).
-- كل طلب مسلّم يبقى "بذمة السائق" (cash_handover_id null) حتى يُربط بتسليم كامل يسجّله أدمن أو موظف (aal2).
-- المسجِّل يكتب المبلغ المستلم فعلاً، والفرق (نقص/زيادة) يُحفظ بملاحظة إلزامية.
--   K19 إعداد الأجرة app_settings.cash_handover_includes_delivery_fee (قرار Q1: إعداد للأدمن، الافتراضي true)
--   K1  public.cash_handovers (RLS بلا صلاحيات لأي دور: الدوال فقط)
--   K2  orders.cash_handover_id (+ قيد delivered، فهرس الرصيد)
--   K4  cash_outstanding، K5 cash_outstanding_orders، K6 record_cash_handover، K7 cash_handover_history (أدمن/موظف aal2)
--   K10 driver_cash_summary، K11 my_cash_handovers (سائق فعّال)
--   K12 correct_cash_handover، K13 report_cash (أدمن aal2)
--   K8  الرصيد الافتتاحي لطلبات ما قبل هذه الـ migration
--   K9  begin_account_deletion: CASH_OUTSTANDING
--   K14 admin_audit.action += 'cash_handover'
-- كل تسليم يحفظ goods/fees وقيمة الإعداد لحظتها ومبلغه المطلوب (قيد CHECK)، فتغيير الإعداد لا يعيد حساب أي تسليم.
-- لا تعديل لـ migration قديمة. لا تغيير بـ set_order_status/accept_order/available_orders/push-dispatch.

-- ---------------------------------------------------------------------
-- K19) إعداد الأجرة
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column cash_handover_includes_delivery_fee boolean not null default true;
comment on column public.app_settings.cash_handover_includes_delivery_fee is
  'Cash handover (SPEC-cash K19, owner Q1): true = the delivery fee goes to the shop (driver hands over the full total); '
  'false = the fee stays with the driver (hands over the goods amount only). Each handover stores the value it used.';

-- ---------------------------------------------------------------------
-- K1) الجدول
-- ---------------------------------------------------------------------
create table public.cash_handovers (
  id                    uuid        primary key default gen_random_uuid(),
  driver_id             uuid        references public.profiles (id) on delete set null,
  kind                  text        not null default 'handover' check (kind in ('handover', 'opening')),
  order_count           integer     not null check (order_count > 0),
  goods_iqd             bigint      not null check (goods_iqd >= 0),
  fees_iqd              bigint      not null check (fees_iqd >= 0),
  includes_delivery_fee boolean     not null,
  expected_iqd          bigint      not null check (expected_iqd >= 0),
  received_iqd          bigint      not null check (received_iqd >= 0),
  difference_iqd        bigint      generated always as (received_iqd - expected_iqd) stored,
  note                  text        check (note is null or char_length(note) <= 300),
  first_delivered_at    timestamptz not null,
  last_delivered_at     timestamptz not null,
  recorded_by           uuid        references public.profiles (id) on delete set null,
  recorded_by_role      text        check (recorded_by_role in ('admin', 'staff')),
  recorded_at           timestamptz not null default now(),
  idempotency_key       uuid        not null unique,
  original_received_iqd bigint      check (original_received_iqd >= 0),
  corrected_at          timestamptz,
  corrected_by          uuid        references public.profiles (id) on delete set null,
  constraint cash_handovers_expected_check
    check (expected_iqd = goods_iqd + case when includes_delivery_fee then fees_iqd else 0 end),
  constraint cash_handovers_note_required check (received_iqd = expected_iqd or note is not null),
  constraint cash_handovers_received_step check (kind = 'opening' or received_iqd % 250 = 0),
  constraint cash_handovers_period_check check (first_delivered_at <= last_delivered_at),
  constraint cash_handovers_kind_role check ((kind = 'opening') = (recorded_by_role is null)),
  constraint cash_handovers_corrected check ((corrected_at is null) = (original_received_iqd is null))
);
comment on table public.cash_handovers is
  'Driver cash handovers (SPEC-cash K1). No policies, no grants: functions only. kind opening = balance closed by the '
  'migration (excluded from reports and history). expected_iqd = goods_iqd + fees_iqd when includes_delivery_fee.';
create index cash_handovers_driver_idx on public.cash_handovers (driver_id, recorded_at desc, id desc);
create index cash_handovers_recorded_idx on public.cash_handovers (recorded_at desc, id desc);
create index cash_handovers_recorded_by_idx on public.cash_handovers (recorded_by) where recorded_by is not null;
create index cash_handovers_corrected_by_idx on public.cash_handovers (corrected_by) where corrected_by is not null;

-- K3) RLS بلا سياسات ولا صلاحيات (حتى الأدمن يقرأ عبر الدوال)
alter table public.cash_handovers enable row level security;
revoke all on public.cash_handovers from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- K2) ربط الطلب بالتسليم
-- ---------------------------------------------------------------------
alter table public.orders
  add column cash_handover_id uuid references public.cash_handovers (id) on delete restrict;
alter table public.orders add constraint orders_cash_handover_delivered_check
  check (cash_handover_id is null or status = 'delivered');
comment on column public.orders.cash_handover_id is
  'Cash handover that closed this delivered order (SPEC-cash K2). Null + delivered = cash still held by the driver.';
-- الرصيد بلا مسح للجدول
create index orders_cash_outstanding_idx on public.orders (driver_id)
  where status = 'delivered' and cash_handover_id is null;
create index orders_cash_handover_idx on public.orders (cash_handover_id) where cash_handover_id is not null;

-- ---------------------------------------------------------------------
-- K8) الرصيد الافتتاحي: كل طلب مسلّم قبل هذه الـ migration يُغلق بصف opening لكل سائق (بلا إشعار ولا تدقيق)
-- ---------------------------------------------------------------------
with per_driver as (
  select o.driver_id, count(*)::int as n, sum(o.subtotal_iqd)::bigint as goods, sum(o.delivery_fee_iqd)::bigint as fees,
         min(coalesce(o.delivered_at, o.created_at)) as first_at, max(coalesce(o.delivered_at, o.created_at)) as last_at
    from public.orders o
   where o.status = 'delivered' and o.driver_id is not null
   group by o.driver_id
), opened as (
  insert into public.cash_handovers (driver_id, kind, order_count, goods_iqd, fees_iqd, includes_delivery_fee,
                                     expected_iqd, received_iqd, first_delivered_at, last_delivered_at, idempotency_key)
  select driver_id, 'opening', n, goods, fees, true, goods + fees, goods + fees, first_at, last_at, gen_random_uuid()
    from per_driver
  returning id, driver_id
)
update public.orders o set cash_handover_id = opened.id
  from opened
 where o.driver_id = opened.driver_id and o.status = 'delivered';

-- ---------------------------------------------------------------------
-- دوال داخلية
-- ---------------------------------------------------------------------
-- "4,000 د.ع" + " · نقص 250 د.ع" / " · زيادة 500 د.ع"
create function private.cash_amount_text(p_received bigint, p_difference bigint)
returns text
language sql immutable set search_path = ''
as $$
  select to_char(p_received, 'FM999,999,999,990') || ' د.ع'
         || case when p_difference < 0 then ' · نقص ' || to_char(-p_difference, 'FM999,999,999,990') || ' د.ع'
                 when p_difference > 0 then ' · زيادة ' || to_char(p_difference, 'FM999,999,999,990') || ' د.ع'
                 else '' end
$$;

create function private.cash_fee_included()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select s.cash_handover_includes_delivery_fee from public.app_settings s where s.id = 1
$$;

create function private.cash_handover_json(p_row public.cash_handovers, p_replayed boolean)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('handover_id', p_row.id, 'driver_id', p_row.driver_id, 'order_count', p_row.order_count,
                            'expected_iqd', p_row.expected_iqd, 'received_iqd', p_row.received_iqd,
                            'difference_iqd', p_row.difference_iqd, 'includes_delivery_fee', p_row.includes_delivery_fee,
                            'recorded_at', p_row.recorded_at, 'replayed', p_replayed)
$$;

revoke all on function private.cash_amount_text(bigint, bigint), private.cash_fee_included(),
  private.cash_handover_json(public.cash_handovers, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- K4) cash_outstanding (أدمن/موظف aal2)
-- ---------------------------------------------------------------------
create function public.cash_outstanding()
returns table (driver_id uuid, full_name text, phone text, is_active boolean, outstanding_iqd bigint, order_count integer,
               oldest_delivered_at timestamptz, last_handover_at timestamptz, last_received_iqd bigint,
               last_difference_iqd bigint, includes_delivery_fee boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fee boolean;
begin
  if not private.is_staff_or_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_fee := private.cash_fee_included();
  return query
    with bal as (
      select o.driver_id as d,
             sum(o.subtotal_iqd + case when v_fee then o.delivery_fee_iqd else 0 end)::bigint as amt,
             count(*)::int as n, min(o.delivered_at) as oldest
        from public.orders o
       where o.status = 'delivered' and o.cash_handover_id is null and o.driver_id is not null
       group by o.driver_id
    )
    select p.id, p.full_name, p.phone, p.is_active, coalesce(b.amt, 0)::bigint, coalesce(b.n, 0), b.oldest,
           h.recorded_at, h.received_iqd, h.difference_iqd, v_fee
      from public.profiles p
      left join bal b on b.d = p.id
      left join lateral (
        select ch.recorded_at, ch.received_iqd, ch.difference_iqd
          from public.cash_handovers ch
         where ch.driver_id = p.id and ch.kind = 'handover'
         order by ch.recorded_at desc, ch.id desc
         limit 1) h on true
     where (p.role = 'driver' and p.is_active) or coalesce(b.n, 0) > 0
     order by coalesce(b.amt, 0) desc, p.full_name, p.id;
end
$$;
comment on function public.cash_outstanding() is
  'Admin/staff (aal2): cash held per driver since the last handover (SPEC-cash K4). Active drivers + any account holding cash.';

-- ---------------------------------------------------------------------
-- K5) cash_outstanding_orders (أدمن/موظف aal2): البلوك والبناية فقط من بيانات الزبون
-- ---------------------------------------------------------------------
create function public.cash_outstanding_orders(p_driver_id uuid)
returns table (order_id uuid, order_number bigint, delivered_at timestamptz, subtotal_iqd bigint, delivery_fee_iqd bigint,
               total_iqd bigint, amount_iqd bigint, subsection text, building text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fee boolean;
begin
  if not private.is_staff_or_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_driver_id is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_driver_id';
  end if;
  v_fee := private.cash_fee_included();
  return query
    select o.id, o.order_number, o.delivered_at, o.subtotal_iqd, o.delivery_fee_iqd, o.total_iqd,
           (o.subtotal_iqd + case when v_fee then o.delivery_fee_iqd else 0 end)::bigint,
           o.address_snapshot ->> 'subsection', o.address_snapshot ->> 'building'
      from public.orders o
     where o.driver_id = p_driver_id and o.status = 'delivered' and o.cash_handover_id is null
     order by o.delivered_at desc, o.id desc
     limit 500;
end
$$;

-- ---------------------------------------------------------------------
-- K6) record_cash_handover (أدمن/موظف aal2، معاملة واحدة، SPEC-cash §3.2)
-- ---------------------------------------------------------------------
create function public.record_cash_handover(p_driver_id uuid, p_expected_iqd bigint, p_order_count integer,
                                            p_received_iqd bigint, p_note text, p_idempotency_key uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_role     public.user_role := private.current_user_role();
  v_note     text;
  v_prev     public.cash_handovers;
  v_row      public.cash_handovers;
  v_fee      boolean;
  v_ids      uuid[];
  v_n        integer;
  v_goods    bigint;
  v_fees     bigint;
  v_first    timestamptz;
  v_last     timestamptz;
  v_expected bigint;
begin
  -- 1) الدور
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  -- 2) المدخلات
  if p_driver_id is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_driver_id';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  if p_expected_iqd is null or p_expected_iqd < 0 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_expected_iqd';
  end if;
  if p_order_count is null or p_order_count <= 0 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_order_count';
  end if;
  if p_received_iqd is null or p_received_iqd < 0 or p_received_iqd % 250 <> 0
     or p_received_iqd > p_expected_iqd + 10000000 then
    raise exception 'CASH_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  v_note := private.clean_user_text(p_note, false);
  if char_length(v_note) > 300 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_note';
  end if;

  -- 3) منع التكرار (سريع)
  select * into v_prev from public.cash_handovers where idempotency_key = p_idempotency_key;
  if found then
    if v_prev.driver_id is distinct from p_driver_id then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'idempotency_key';
    end if;
    return private.cash_handover_json(v_prev, true);
  end if;

  -- 4) قفل السائق: تسليمان لنفس السائق يتسلسلان؛ ثم إعادة فحص المفتاح (ضغطتان متوازيتان)
  perform pg_advisory_xact_lock(hashtextextended('cash_handover:' || p_driver_id::text, 0));
  select * into v_prev from public.cash_handovers where idempotency_key = p_idempotency_key;
  if found then
    if v_prev.driver_id is distinct from p_driver_id then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'idempotency_key';
    end if;
    return private.cash_handover_json(v_prev, true);
  end if;

  -- 5) قفل الطلبات بذمة السائق (بترتيب id) بجملة واحدة: ما يُقفل هو ما يُربط
  select array_agg(x.id order by x.id) into v_ids
    from (select o.id from public.orders o
           where o.driver_id = p_driver_id and o.status = 'delivered' and o.cash_handover_id is null
           order by o.id
             for update) x;
  if v_ids is null then
    raise exception 'NO_CASH_OUTSTANDING' using errcode = 'P0001';
  end if;

  -- 6) الإعداد والمقارنة المتفائلة
  v_fee := private.cash_fee_included();
  select count(*)::int, sum(o.subtotal_iqd)::bigint, sum(o.delivery_fee_iqd)::bigint,
         min(coalesce(o.delivered_at, o.created_at)), max(coalesce(o.delivered_at, o.created_at))
    into v_n, v_goods, v_fees, v_first, v_last
    from public.orders o where o.id = any (v_ids);
  v_expected := v_goods + case when v_fee then v_fees else 0 end;
  if v_expected <> p_expected_iqd or v_n <> p_order_count then
    raise exception 'CASH_BALANCE_CHANGED' using errcode = 'P0001',
      detail = jsonb_build_object('expected_iqd', v_expected, 'order_count', v_n)::text;
  end if;

  -- 7) الملاحظة إلزامية مع أي فرق
  if p_received_iqd <> v_expected and v_note is null then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;

  -- 8) الإدراج والربط
  insert into public.cash_handovers (driver_id, order_count, goods_iqd, fees_iqd, includes_delivery_fee, expected_iqd,
                                     received_iqd, note, first_delivered_at, last_delivered_at, recorded_by,
                                     recorded_by_role, idempotency_key)
  values (p_driver_id, v_n, v_goods, v_fees, v_fee, v_expected, p_received_iqd, v_note, v_first, v_last, auth.uid(),
          v_role::text, p_idempotency_key)
  returning * into v_row;
  update public.orders o set cash_handover_id = v_row.id where o.id = any (v_ids);

  -- 9) التدقيق
  insert into public.admin_audit (actor, action, target_id, after)
  values (auth.uid(), 'cash_handover', v_row.id,
          jsonb_build_object('op', 'record', 'driver_id', p_driver_id, 'order_count', v_n, 'expected_iqd', v_expected,
                             'received_iqd', p_received_iqd, 'difference_iqd', v_row.difference_iqd,
                             'includes_delivery_fee', v_fee, 'note', v_note));

  -- 10) الإشعار
  perform public._notify('user', p_driver_id, 'تسليم الكاش',
                         'استلمنا منك ' || private.cash_amount_text(p_received_iqd, v_row.difference_iqd),
                         jsonb_build_object('type', 'cash_handover', 'handover_id', v_row.id));

  return private.cash_handover_json(v_row, false);
end
$$;
comment on function public.record_cash_handover(uuid, bigint, integer, bigint, text, uuid) is
  'Admin/staff (aal2): closes the whole driver balance (SPEC-cash §3.2). Refuses with CASH_BALANCE_CHANGED if the amount '
  'or count differs from what was shown. Idempotent per key. Audited; the driver is notified.';

-- ---------------------------------------------------------------------
-- K7) cash_handover_history (أدمن: الكل؛ موظف: آخر 7 أيام بغداد)
-- ---------------------------------------------------------------------
create function public.cash_handover_history(
  p_driver_id uuid default null, p_from date default null, p_to date default null, p_limit integer default 50,
  p_before_at timestamptz default null, p_before_id uuid default null)
returns table (id uuid, driver_id uuid, driver_name text, order_count integer, goods_iqd bigint, fees_iqd bigint,
               includes_delivery_fee boolean, expected_iqd bigint, received_iqd bigint, difference_iqd bigint, note text,
               first_delivered_at timestamptz, last_delivered_at timestamptz, recorded_by uuid, recorded_by_name text,
               recorded_by_role text, recorded_at timestamptz, original_received_iqd bigint, corrected_at timestamptz,
               corrected_by uuid, corrected_by_name text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_admin boolean;
  v_floor timestamptz;
begin
  if not private.is_staff_or_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;
  v_admin := private.is_admin();
  v_floor := private.staff_window_start();   -- null للأدمن
  return query
    select h.id, h.driver_id, d.full_name, h.order_count, h.goods_iqd, h.fees_iqd, h.includes_delivery_fee,
           h.expected_iqd, h.received_iqd, h.difference_iqd, h.note, h.first_delivered_at, h.last_delivered_at,
           h.recorded_by, r.full_name, h.recorded_by_role, h.recorded_at,
           case when v_admin then h.original_received_iqd end, h.corrected_at, h.corrected_by, c.full_name
      from public.cash_handovers h
      left join public.profiles d on d.id = h.driver_id
      left join public.profiles r on r.id = h.recorded_by
      left join public.profiles c on c.id = h.corrected_by
     where h.kind = 'handover'
       and (p_driver_id is null or h.driver_id = p_driver_id)
       and (p_from is null or h.recorded_at >= private.baghdad_start(p_from))
       and (p_to   is null or h.recorded_at <  private.baghdad_start(p_to + 1))
       and (v_floor is null or h.recorded_at >= v_floor)
       and (p_before_at is null or p_before_id is null or (h.recorded_at, h.id) < (p_before_at, p_before_id))
     order by h.recorded_at desc, h.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

-- ---------------------------------------------------------------------
-- K10) driver_cash_summary (سائق فعّال): صف واحد دائماً
-- ---------------------------------------------------------------------
create function public.driver_cash_summary()
returns table (outstanding_iqd bigint, order_count integer, oldest_delivered_at timestamptz, last_handover_at timestamptz,
               last_received_iqd bigint, last_difference_iqd bigint, includes_delivery_fee boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_fee boolean;
begin
  if private.current_user_role() is distinct from 'driver' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_fee := private.cash_fee_included();
  return query
    select coalesce(b.amt, 0)::bigint, coalesce(b.n, 0), b.oldest, h.recorded_at, h.received_iqd, h.difference_iqd, v_fee
      from (select sum(o.subtotal_iqd + case when v_fee then o.delivery_fee_iqd else 0 end)::bigint as amt,
                   count(*)::int as n, min(o.delivered_at) as oldest
              from public.orders o
             where o.driver_id = v_uid and o.status = 'delivered' and o.cash_handover_id is null) b
      left join lateral (
        select ch.recorded_at, ch.received_iqd, ch.difference_iqd
          from public.cash_handovers ch
         where ch.driver_id = v_uid and ch.kind = 'handover'
         order by ch.recorded_at desc, ch.id desc
         limit 1) h on true;
end
$$;

-- ---------------------------------------------------------------------
-- K11) my_cash_handovers (سائق فعّال، صفوفه فقط، بلا opening)
-- ---------------------------------------------------------------------
create function public.my_cash_handovers(p_limit integer default 20, p_before_at timestamptz default null,
                                         p_before_id uuid default null)
returns table (id uuid, recorded_at timestamptz, order_count integer, expected_iqd bigint, received_iqd bigint,
               difference_iqd bigint, includes_delivery_fee boolean, note text, recorded_by_name text,
               corrected_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if private.current_user_role() is distinct from 'driver' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return query
    select h.id, h.recorded_at, h.order_count, h.expected_iqd, h.received_iqd, h.difference_iqd, h.includes_delivery_fee,
           h.note, nullif(split_part(btrim(r.full_name), ' ', 1), ''), h.corrected_at
      from public.cash_handovers h
      left join public.profiles r on r.id = h.recorded_by
     where h.driver_id = v_uid and h.kind = 'handover'
       and (p_before_at is null or p_before_id is null or (h.recorded_at, h.id) < (p_before_at, p_before_id))
     order by h.recorded_at desc, h.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100);
end
$$;

-- ---------------------------------------------------------------------
-- K12) correct_cash_handover (أدمن aal2، مُدقَّق، يُبلَّغ السائق؛ الطلبات المربوطة لا تتغير)
-- ---------------------------------------------------------------------
create function public.correct_cash_handover(p_id uuid, p_received_iqd bigint, p_note text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_old  public.cash_handovers;
  v_row  public.cash_handovers;
  v_note text;
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'HANDOVER_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_old from public.cash_handovers where id = p_id for update;
  if not found or v_old.kind <> 'handover' then
    raise exception 'HANDOVER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_received_iqd is null or p_received_iqd < 0 or p_received_iqd % 250 <> 0
     or p_received_iqd > v_old.expected_iqd + 10000000 then
    raise exception 'CASH_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  v_note := private.clean_user_text(p_note, false);
  if v_note is null then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 300 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_note';
  end if;
  if p_received_iqd = v_old.received_iqd then
    return private.cash_handover_json(v_old, false) || jsonb_build_object('changed', false);
  end if;

  update public.cash_handovers
     set original_received_iqd = coalesce(original_received_iqd, received_iqd),
         received_iqd = p_received_iqd, note = v_note, corrected_at = now(), corrected_by = auth.uid()
   where id = p_id
  returning * into v_row;

  insert into public.admin_audit (actor, action, target_id, before, after)
  values (auth.uid(), 'cash_handover', p_id,
          jsonb_build_object('received_iqd', v_old.received_iqd, 'difference_iqd', v_old.difference_iqd, 'note', v_old.note),
          jsonb_build_object('op', 'correct', 'driver_id', v_old.driver_id, 'received_iqd', v_row.received_iqd,
                             'difference_iqd', v_row.difference_iqd, 'note', v_note));

  if v_row.driver_id is not null then
    perform public._notify('user', v_row.driver_id, 'تسليم الكاش',
                           'تعدّل تسليم الكاش: ' || private.cash_amount_text(v_row.received_iqd, v_row.difference_iqd),
                           jsonb_build_object('type', 'cash_handover', 'handover_id', p_id));
  end if;
  return private.cash_handover_json(v_row, false) || jsonb_build_object('changed', true);
end
$$;

-- ---------------------------------------------------------------------
-- K13) report_cash (أدمن aal2، بيوم recorded_at بغداد، 1..366 يوماً)
-- ---------------------------------------------------------------------
create function public.report_cash(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fee boolean;
  v     jsonb;
begin
  perform private.report_guard(p_from, p_to);
  v_fee := private.cash_fee_included();

  with held as (
    select o.driver_id, sum(o.subtotal_iqd + case when v_fee then o.delivery_fee_iqd else 0 end)::bigint as amt
      from public.orders o
     where o.status = 'delivered' and o.cash_handover_id is null and o.driver_id is not null
     group by o.driver_id
  ), per as (
    select ch.driver_id, count(*)::int as n, sum(ch.expected_iqd)::bigint as e, sum(ch.received_iqd)::bigint as r,
           sum(case when ch.difference_iqd < 0 then -ch.difference_iqd else 0 end)::bigint as s,
           sum(case when ch.difference_iqd > 0 then ch.difference_iqd else 0 end)::bigint as ov
      from public.cash_handovers ch
     where ch.kind = 'handover'
       and ch.recorded_at >= private.baghdad_start(p_from)
       and ch.recorded_at <  private.baghdad_start(p_to + 1)
     group by ch.driver_id
  ), ids as (
    select per.driver_id from per
    union
    select held.driver_id from held where held.amt > 0
  )
  select jsonb_build_object(
           'from', p_from, 'to', p_to,
           'held_now_iqd', (select coalesce(sum(held.amt), 0)::bigint from held),
           'held_now_drivers', (select count(*)::int from held where held.amt > 0),
           'totals', (select jsonb_build_object(
                               'handover_count', coalesce(sum(per.n), 0)::int,
                               'expected_iqd', coalesce(sum(per.e), 0)::bigint,
                               'received_iqd', coalesce(sum(per.r), 0)::bigint,
                               'shortage_iqd', coalesce(sum(per.s), 0)::bigint,
                               'overage_iqd', coalesce(sum(per.ov), 0)::bigint,
                               'net_difference_iqd', coalesce(sum(per.r - per.e), 0)::bigint)
                        from per),
           'drivers', coalesce((select jsonb_agg(jsonb_build_object(
                                         'driver_id', i.driver_id, 'full_name', p.full_name,
                                         'handover_count', coalesce(q.n, 0), 'expected_iqd', coalesce(q.e, 0),
                                         'received_iqd', coalesce(q.r, 0), 'shortage_iqd', coalesce(q.s, 0),
                                         'overage_iqd', coalesce(q.ov, 0), 'net_difference_iqd', coalesce(q.r - q.e, 0),
                                         'held_now_iqd', coalesce(hd.amt, 0))
                                       order by p.full_name nulls last, i.driver_id)
                                  from ids i
                                  left join per q on q.driver_id is not distinct from i.driver_id
                                  left join held hd on hd.driver_id = i.driver_id
                                  left join public.profiles p on p.id = i.driver_id), '[]'::jsonb))
    into v;
  return v;
end
$$;
comment on function public.report_cash(date, date) is
  'Admin (aal2): cash held now, and per driver in the range (Baghdad day of recorded_at): handovers, expected, received, '
  'shortage and overage kept separate (SPEC-cash K13). Opening balances excluded.';
-- ---------------------------------------------------------------------
-- K9) حذف الحساب: لا حذف برصيد كاش (نسخة 20261202000001 + CASH_OUTSTANDING)
-- ---------------------------------------------------------------------
create or replace function public.begin_account_deletion(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_role      public.user_role;
  v_is_active boolean;
  v_cash      bigint;
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
  -- T23 F L7: حسابات الإدارة (أدمن وموظف) تُعطَّل من اللوحة، لا تُحذف بالـ PIN وحده
  if v_role in ('admin', 'staff') then
    raise exception 'ADMIN_ACCOUNT' using errcode = '42501';
  end if;
  if exists (select 1 from public.orders o
              where (o.customer_id = p_user_id or o.driver_id = p_user_id)
                and o.status in ('pending', 'preparing', 'ready', 'out_for_delivery')) then
    raise exception 'ACTIVE_ORDER' using errcode = 'P0001';
  end if;
  -- T40 K9: كاش بذمته لم يُسلَّم (بقفل التسليم نفسه: لا تسليم يتداخل مع الفحص)
  perform pg_advisory_xact_lock(hashtextextended('cash_handover:' || p_user_id::text, 0));
  if exists (select 1 from public.orders o
              where o.driver_id = p_user_id and o.status = 'delivered' and o.cash_handover_id is null) then
    select sum(o.subtotal_iqd + case when private.cash_fee_included() then o.delivery_fee_iqd else 0 end)::bigint
      into v_cash
      from public.orders o
     where o.driver_id = p_user_id and o.status = 'delivered' and o.cash_handover_id is null;
    raise exception 'CASH_OUTSTANDING' using errcode = 'P0001', detail = v_cash::text;
  end if;

  insert into private.account_deletions (user_id, was_active)
  values (p_user_id, v_is_active)
  on conflict (user_id) do nothing;
  select d.was_active into v_is_active from private.account_deletions d where d.user_id = p_user_id;

  update public.profiles set is_active = false where id = p_user_id;
  return v_is_active;
end
$$;

-- ---------------------------------------------------------------------
-- K14) التدقيق
-- ---------------------------------------------------------------------
alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check
  check (action in ('user_role', 'settings', 'order_driver', 'notifications_dismissed', 'address', 'mfa_reset',
                    'customer_lockdown', 'category', 'driver_request', 'cash_handover'));

-- ---------------------------------------------------------------------
-- K19) update_app_settings: نسخة 20261202000001 + cash_handover_includes_delivery_fee (boolean، مُدقَّق)
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
                     'max_line_qty', 'max_order_lines', 'new_account_max_active_orders',
                     'max_order_iqd', 'new_account_max_order_iqd', 'cash_handover_includes_delivery_fee') then
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

  -- حدّا قيمة الطلب (M3): مضاعفات 250، من 250 إلى 100,000,000
  foreach v_key in array array['max_order_iqd', 'new_account_max_order_iqd'] loop
    if p ? v_key then
      if jsonb_typeof(p -> v_key) <> 'number' then
        raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = v_key;
      end if;
      v_num := (p ->> v_key)::numeric;
      if v_num <> trunc(v_num) or v_num < 250 or v_num > 100000000 or v_num % 250 <> 0 then
        raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = v_key;
      end if;
    end if;
  end loop;

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

  foreach v_key in array array['store_open', 'cash_handover_includes_delivery_fee'] loop
    if p ? v_key and jsonb_typeof(p -> v_key) <> 'boolean' then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;

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
    max_order_iqd     = case when p ? 'max_order_iqd'     then (p ->> 'max_order_iqd')::numeric::bigint else max_order_iqd end,
    new_account_max_order_iqd =
      case when p ? 'new_account_max_order_iqd' then (p ->> 'new_account_max_order_iqd')::numeric::bigint
           else new_account_max_order_iqd end,
    store_open        = case when p ? 'store_open'        then (p ->> 'store_open')::boolean else store_open end,
    closed_message    = case when p ? 'closed_message'    then v_msg else closed_message end,
    cash_handover_includes_delivery_fee =
      case when p ? 'cash_handover_includes_delivery_fee' then (p ->> 'cash_handover_includes_delivery_fee')::boolean
           else cash_handover_includes_delivery_fee end
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
-- K16) الصلاحيات (الدوال الجديدة لا تُنفَّذ افتراضياً؛ كل منح صريح، والدالة تفحص الدور)
-- ---------------------------------------------------------------------
revoke all on function public.cash_outstanding(), public.cash_outstanding_orders(uuid),
  public.record_cash_handover(uuid, bigint, integer, bigint, text, uuid),
  public.cash_handover_history(uuid, date, date, integer, timestamptz, uuid),
  public.driver_cash_summary(), public.my_cash_handovers(integer, timestamptz, uuid),
  public.correct_cash_handover(uuid, bigint, text), public.report_cash(date, date)
  from public, anon, service_role;
grant execute on function public.cash_outstanding(), public.cash_outstanding_orders(uuid),
  public.record_cash_handover(uuid, bigint, integer, bigint, text, uuid),
  public.cash_handover_history(uuid, date, date, integer, timestamptz, uuid),
  public.driver_cash_summary(), public.my_cash_handovers(integer, timestamptz, uuid),
  public.correct_cash_handover(uuid, bigint, text), public.report_cash(date, date)
  to authenticated;
