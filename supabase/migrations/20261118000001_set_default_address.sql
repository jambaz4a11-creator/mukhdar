-- =====================================================================
-- set_default_address (T13، قرار المالك 2026-11-15): تعيين العنوان الافتراضي بمعاملة واحدة.
-- قبلها كان التطبيق يرسل طلبين (إلغاء القديم ثم تعيين الجديد)، وفشل الثاني يترك الزبون بلا افتراضي.
-- security invoker: تعمل بصلاحيات الزبون نفسه (RLS على addresses + صلاحية update على is_default)،
-- فلا تضيف دالة SECURITY DEFINER جديدة (Advisor) ولا تستطيع لمس عناوين غيره.
-- قفل استشاري لكل زبون: استدعاءان متزامنان لا يصطدمان بفهرس addresses_one_default_idx.
-- =====================================================================

create or replace function public.set_default_address(p_address_id uuid)
returns void
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('set_default_address:' || v_uid::text, 0));

  perform 1 from public.addresses where id = p_address_id and customer_id = v_uid;
  if not found then
    raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- خطوتان بنفس المعاملة: الفهرس الجزئي unique يُفحص لكل صف، فنلغي القديم أولاً
  update public.addresses set is_default = false
   where customer_id = v_uid and is_default and id <> p_address_id;
  update public.addresses set is_default = true
   where id = p_address_id and customer_id = v_uid and not is_default;
end
$$;

revoke all on function public.set_default_address(uuid) from public, anon;
grant execute on function public.set_default_address(uuid) to authenticated;
