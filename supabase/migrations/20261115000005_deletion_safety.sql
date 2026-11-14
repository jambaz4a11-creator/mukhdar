-- =====================================================================
-- أمان حذف الحساب (مراجعة 2026-11-14: N1، N2)
--   N1: accept_order يأخذ قفل مشاركة على ملف السائق فيتسلسل مع begin_account_deletion.
--   N2: is_active الأصلي يُحفظ بـ private.account_deletions عند أول محاولة حذف؛
--       begin_account_deletion يرجعه، و abort_account_deletion يستعيده ثم يحذف السجل.
--       الحذف الناجح يحذف الملف فيُحذف السجل معه (cascade).
-- التعريفات منسوخة من آخر نسخة (20261115000002، 20261112000004) والتعديل محصور بما سبق.
-- =====================================================================
create table private.account_deletions (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  was_active boolean not null,
  started_at timestamptz not null default now()
);
revoke all on private.account_deletions from public, anon, authenticated;

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

  -- N1: يتسلسل مع begin_account_deletion (تقفل صف الملف for update): إن بدأ حذف الحساب أولاً
  -- يصبح الحساب غير نشط فيُرفض القبول؛ وإن قُبل الطلب أولاً يرى الحذف طلباً نشطاً (ACTIVE_ORDER).
  perform 1 from public.profiles where id = v_uid and is_active for share;
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

  -- N2: الحالة الأصلية تُحفظ عند أول محاولة؛ محاولة لاحقة بعد انقطاع (الحساب صار غير نشط)
  -- ترجع الحالة الأصلية لا الحالية، فلا يُستعاد خطأً كغير نشط عند الإلغاء.
  insert into private.account_deletions (user_id, was_active)
  values (p_user_id, v_is_active)
  on conflict (user_id) do nothing;
  select d.was_active into v_is_active from private.account_deletions d where d.user_id = p_user_id;

  update public.profiles set is_active = false where id = p_user_id;
  return v_is_active;
end
$$;

create or replace function public.abort_account_deletion(p_user_id uuid, p_was_active boolean)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.profiles
     set is_active = coalesce((select d.was_active from private.account_deletions d where d.user_id = p_user_id),
                              p_was_active, is_active)
   where id = p_user_id;
  delete from private.account_deletions where user_id = p_user_id;
$$;
