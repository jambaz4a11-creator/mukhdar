-- =====================================================================
-- R4 fixes (docs/reviews/R4-cash-review.md) for the cash handover (SPEC-cash).
-- Function bodies are copied from 20261212000001_cash_handover.sql; only the changes below differ.
--   M1  report_cash: fees_kept_iqd (Σ fees_iqd of handovers recorded with "fee stays with the driver"), in totals and
--       per driver. New cash_fee_setting_impact() (admin aal2): fees on cash held now, for the /settings confirmation.
--   L1  begin_account_deletion takes the cash_handover advisory lock BEFORE `profiles ... for update`
--       (record_cash_handover takes the advisory lock, then FK KEY SHARE on the same profile: same order = no deadlock).
--   L2  record_cash_handover: a replayed key with a different amount, expected, count or note ← INVALID_REQUEST
--       (detail idempotency_key) instead of silently returning the first row.
--   L3  the same key for two drivers at the same instant ← INVALID_REQUEST idempotency_key (not a raw 23505).
--   L4  p_expected_iqd above 10^12 ← INVALID_REQUEST p_expected_iqd (no bigint overflow).
--   L5  cash_outstanding: for staff, the last handover's amount and difference are null when it is older than the
--       staff window (Baghdad today − 6), like cash_handover_history.
--   L6  correct_cash_handover gains p_expected_received (optimistic check): differs from the stored amount ←
--       HANDOVER_CHANGED (detail = stored amount). The same amount stays a no-op (changed: false) before the check, so
--       a double click is harmless. The old 3-argument signature is dropped (no data involved) and replaced.
--   L9  no cash notification to an account whose role is no longer 'driver'.
-- No table, column or row changes. No change to set_order_status, accept_order, assign_driver or update_app_settings.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Internal: replay of an existing key (L2). Same driver and same request ← the stored result (replayed: true);
-- anything else ← INVALID_REQUEST idempotency_key. A later admin correction changes received/note: the original
-- amount is compared, and the note only while the row is uncorrected.
-- ---------------------------------------------------------------------
create function private.cash_replay(p_prev public.cash_handovers, p_driver_id uuid, p_expected_iqd bigint,
                                    p_order_count integer, p_received_iqd bigint, p_note text)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
begin
  if p_prev.driver_id is distinct from p_driver_id
     or p_prev.expected_iqd <> p_expected_iqd
     or p_prev.order_count <> p_order_count
     or coalesce(p_prev.original_received_iqd, p_prev.received_iqd) <> p_received_iqd
     or (p_prev.corrected_at is null and p_prev.note is distinct from p_note) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'idempotency_key';
  end if;
  return private.cash_handover_json(p_prev, true);
end
$$;
revoke all on function private.cash_replay(public.cash_handovers, uuid, bigint, integer, bigint, text)
  from public, anon, authenticated, service_role;

-- Internal: is this account still a driver (L9)?
create function private.cash_is_driver(p_id uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_id and p.role = 'driver')
$$;
revoke all on function private.cash_is_driver(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- K4) cash_outstanding (L5: staff don't see the last amount older than the 7-day window)
-- ---------------------------------------------------------------------
create or replace function public.cash_outstanding()
returns table (driver_id uuid, full_name text, phone text, is_active boolean, outstanding_iqd bigint, order_count integer,
               oldest_delivered_at timestamptz, last_handover_at timestamptz, last_received_iqd bigint,
               last_difference_iqd bigint, includes_delivery_fee boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fee   boolean;
  v_floor timestamptz;
begin
  if not private.is_staff_or_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_fee := private.cash_fee_included();
  v_floor := private.staff_window_start();   -- null for an admin
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
           h.recorded_at,
           case when v_floor is null or h.recorded_at >= v_floor then h.received_iqd end,
           case when v_floor is null or h.recorded_at >= v_floor then h.difference_iqd end,
           v_fee
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

-- ---------------------------------------------------------------------
-- K6) record_cash_handover (L2, L3, L4, L9)
-- ---------------------------------------------------------------------
create or replace function public.record_cash_handover(p_driver_id uuid, p_expected_iqd bigint, p_order_count integer,
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
  -- 1) role
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  -- 2) input
  if p_driver_id is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_driver_id';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  -- L4: a sane cap so expected + 10,000,000 below can't overflow bigint
  if p_expected_iqd is null or p_expected_iqd < 0 or p_expected_iqd > 1000000000000 then
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

  -- 3) idempotency (fast path). L2: a different request under the same key is refused
  select * into v_prev from public.cash_handovers where idempotency_key = p_idempotency_key;
  if found then
    return private.cash_replay(v_prev, p_driver_id, p_expected_iqd, p_order_count, p_received_iqd, v_note);
  end if;

  -- 4) driver lock, then check the key again (two parallel clicks)
  perform pg_advisory_xact_lock(hashtextextended('cash_handover:' || p_driver_id::text, 0));
  select * into v_prev from public.cash_handovers where idempotency_key = p_idempotency_key;
  if found then
    return private.cash_replay(v_prev, p_driver_id, p_expected_iqd, p_order_count, p_received_iqd, v_note);
  end if;

  -- 5) lock the driver's outstanding orders (id order) in one statement: what is locked is what gets linked
  select array_agg(x.id order by x.id) into v_ids
    from (select o.id from public.orders o
           where o.driver_id = p_driver_id and o.status = 'delivered' and o.cash_handover_id is null
           order by o.id
             for update) x;
  if v_ids is null then
    raise exception 'NO_CASH_OUTSTANDING' using errcode = 'P0001';
  end if;

  -- 6) setting and optimistic comparison
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

  -- 7) a note is required with any difference
  if p_received_iqd <> v_expected and v_note is null then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;

  -- 8) insert and link. L3: the same key used for another driver at the same instant (different driver locks)
  begin
    insert into public.cash_handovers (driver_id, order_count, goods_iqd, fees_iqd, includes_delivery_fee, expected_iqd,
                                       received_iqd, note, first_delivered_at, last_delivered_at, recorded_by,
                                       recorded_by_role, idempotency_key)
    values (p_driver_id, v_n, v_goods, v_fees, v_fee, v_expected, p_received_iqd, v_note, v_first, v_last, auth.uid(),
            v_role::text, p_idempotency_key)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'idempotency_key';
  end;
  update public.orders o set cash_handover_id = v_row.id where o.id = any (v_ids);

  -- 9) audit
  insert into public.admin_audit (actor, action, target_id, after)
  values (auth.uid(), 'cash_handover', v_row.id,
          jsonb_build_object('op', 'record', 'driver_id', p_driver_id, 'order_count', v_n, 'expected_iqd', v_expected,
                             'received_iqd', p_received_iqd, 'difference_iqd', v_row.difference_iqd,
                             'includes_delivery_fee', v_fee, 'note', v_note));

  -- 10) notification (L9: only while the account is still a driver)
  if private.cash_is_driver(p_driver_id) then
    perform public._notify('user', p_driver_id, 'تسليم الكاش',
                           'استلمنا منك ' || private.cash_amount_text(p_received_iqd, v_row.difference_iqd),
                           jsonb_build_object('type', 'cash_handover', 'handover_id', v_row.id));
  end if;

  return private.cash_handover_json(v_row, false);
end
$$;

-- ---------------------------------------------------------------------
-- K12) correct_cash_handover (L6: optimistic check; L9). The 3-argument version is replaced.
-- ---------------------------------------------------------------------
drop function public.correct_cash_handover(uuid, bigint, text);

create function public.correct_cash_handover(p_id uuid, p_received_iqd bigint, p_note text,
                                             p_expected_received bigint default null)
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
  -- the same amount: nothing to do (a double click after a successful save lands here, before the version check)
  if p_received_iqd = v_old.received_iqd then
    return private.cash_handover_json(v_old, false) || jsonb_build_object('changed', false);
  end if;
  -- L6: someone corrected the row after this admin opened it
  if p_expected_received is not null and p_expected_received <> v_old.received_iqd then
    raise exception 'HANDOVER_CHANGED' using errcode = 'P0001', detail = v_old.received_iqd::text;
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

  if v_row.driver_id is not null and private.cash_is_driver(v_row.driver_id) then
    perform public._notify('user', v_row.driver_id, 'تسليم الكاش',
                           'تعدّل تسليم الكاش: ' || private.cash_amount_text(v_row.received_iqd, v_row.difference_iqd),
                           jsonb_build_object('type', 'cash_handover', 'handover_id', p_id));
  end if;
  return private.cash_handover_json(v_row, false) || jsonb_build_object('changed', true);
end
$$;
comment on function public.correct_cash_handover(uuid, bigint, text, bigint) is
  'Admin (aal2): corrects the received amount and note of a handover (SPEC-cash K12). p_expected_received = the amount '
  'the admin saw; if the row changed since ← HANDOVER_CHANGED. Same amount ← no-op. Audited; the driver is notified.';

-- ---------------------------------------------------------------------
-- K13) report_cash (M1: fees_kept_iqd)
-- ---------------------------------------------------------------------
create or replace function public.report_cash(p_from date, p_to date)
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
           sum(case when ch.difference_iqd > 0 then ch.difference_iqd else 0 end)::bigint as ov,
           sum(case when ch.includes_delivery_fee then 0 else ch.fees_iqd end)::bigint as fk
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
                               'net_difference_iqd', coalesce(sum(per.r - per.e), 0)::bigint,
                               'fees_kept_iqd', coalesce(sum(per.fk), 0)::bigint)
                        from per),
           'drivers', coalesce((select jsonb_agg(jsonb_build_object(
                                         'driver_id', i.driver_id, 'full_name', p.full_name,
                                         'handover_count', coalesce(q.n, 0), 'expected_iqd', coalesce(q.e, 0),
                                         'received_iqd', coalesce(q.r, 0), 'shortage_iqd', coalesce(q.s, 0),
                                         'overage_iqd', coalesce(q.ov, 0), 'net_difference_iqd', coalesce(q.r - q.e, 0),
                                         'fees_kept_iqd', coalesce(q.fk, 0),
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
  'shortage and overage kept separate, and delivery fees kept by drivers (SPEC-cash K13). Opening balances excluded.';

-- ---------------------------------------------------------------------
-- K20 (M1) cash_fee_setting_impact (admin aal2): delivery fees on the cash drivers hold now. Changing the fee setting
-- moves exactly this amount in or out of what they must hand over; /settings asks for confirmation when > 0.
-- ---------------------------------------------------------------------
create function public.cash_fee_setting_impact()
returns table (driver_count integer, order_count integer, fees_iqd bigint, includes_delivery_fee boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return query
    select count(distinct o.driver_id)::int, count(*)::int, coalesce(sum(o.delivery_fee_iqd), 0)::bigint,
           private.cash_fee_included()
      from public.orders o
     where o.status = 'delivered' and o.cash_handover_id is null and o.driver_id is not null
       and o.delivery_fee_iqd > 0;
end
$$;
comment on function public.cash_fee_setting_impact() is
  'Admin (aal2): delivery fees on cash held by drivers now (SPEC-cash K20), shown before the fee setting is changed.';

-- ---------------------------------------------------------------------
-- K9) begin_account_deletion (L1: cash_handover lock before the profile row lock)
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
  -- R4 L1: the cash lock comes before the profile row lock below. record_cash_handover holds it and then takes
  -- KEY SHARE on this profile (its foreign keys); the reverse order here deadlocked.
  perform pg_advisory_xact_lock(hashtextextended('cash_handover:' || p_user_id::text, 0));

  select p.role, p.is_active into v_role, v_is_active
    from public.profiles p where p.id = p_user_id
     for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- T23 F L7: management accounts (admin and staff) are deactivated from the panel, not deleted with the PIN alone
  if v_role in ('admin', 'staff') then
    raise exception 'ADMIN_ACCOUNT' using errcode = '42501';
  end if;
  if exists (select 1 from public.orders o
              where (o.customer_id = p_user_id or o.driver_id = p_user_id)
                and o.status in ('pending', 'preparing', 'ready', 'out_for_delivery')) then
    raise exception 'ACTIVE_ORDER' using errcode = 'P0001';
  end if;
  -- T40 K9: cash held and not handed over (under the handover lock taken above)
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
-- Privileges (the replaced/new functions: explicit grants; each function checks the role)
-- ---------------------------------------------------------------------
revoke all on function public.correct_cash_handover(uuid, bigint, text, bigint), public.cash_fee_setting_impact()
  from public, anon, service_role;
grant execute on function public.correct_cash_handover(uuid, bigint, text, bigint), public.cash_fee_setting_impact()
  to authenticated;
