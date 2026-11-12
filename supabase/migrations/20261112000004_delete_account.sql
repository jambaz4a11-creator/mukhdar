-- =====================================================================
-- T08: حذف الحساب (Edge Function `delete-account`)
--   الدالة تستدعي begin_account_deletion (فحص + تعطيل بمعاملة واحدة) ثم auth.admin.deleteUser.
--   إن فشل deleteUser تستدعي abort_account_deletion لإرجاع الحالة.
--   بعد الحذف: profiles تُحذف (cascade من auth.users)، ومعها العناوين ورموز الإشعارات،
--   والطلبات والتقييمات والسجل تبقى مع customer_id/driver_id/changed_by = null (on delete set null).
-- =====================================================================

-- ---------------------------------------------------------------------
-- begin_account_deletion: يرجع is_active السابق (لـ abort).
--   * نفس القفل الاستشاري لـ place_order: لا طلب قيد الإنشاء لنفس الزبون أثناء الفحص.
--   * admin لا يُحذف من التطبيق (ADMIN_ACCOUNT).
--   * طلب غير منتهٍ كزبون أو كسائق معيَّن ← ACTIVE_ORDER.
--   * التعطيل (is_active = false) يمنع place_order و accept_order والتعيين حتى يكتمل الحذف.
-- ---------------------------------------------------------------------
create function public.begin_account_deletion(p_user_id uuid)
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
                and o.status in ('pending', 'preparing', 'out_for_delivery')) then
    raise exception 'ACTIVE_ORDER' using errcode = 'P0001';
  end if;

  update public.profiles set is_active = false where id = p_user_id;
  return v_is_active;
end
$$;

create function public.abort_account_deletion(p_user_id uuid, p_was_active boolean)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.profiles set is_active = coalesce(p_was_active, is_active) where id = p_user_id;
$$;

revoke all on function public.begin_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.abort_account_deletion(uuid, boolean) from public, anon, authenticated;
grant execute on function public.begin_account_deletion(uuid) to service_role;
grant execute on function public.abort_account_deletion(uuid, boolean) to service_role;
