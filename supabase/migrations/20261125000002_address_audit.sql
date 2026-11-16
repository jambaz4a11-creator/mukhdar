-- مراجعة الإصلاحات AB، جلسة C، L8(ب): إعادة تسمية أو إخفاء قطاع/وحدة/عمارة تغيّر كل العناوين المحفوظة
-- المرتبطة به، فتُسجَّل بـ admin_audit (action = 'address') مع القديم ← الجديد.
-- يُسجَّل فقط تغيير الاسم/الرقم/التفعيل (الترتيب sort_order لا يغيّر عنواناً). الإضافة بالجملة (add_buildings)
-- ليست تغييراً لعناوين قائمة فلا تُسجَّل. لا تعديل لـ migration قديمة.

alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check
  check (action in ('user_role', 'settings', 'order_driver', 'notifications_dismissed', 'address'));

create function public.tg_audit_address_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_table_name = 'buildings' then
    if new.number is not distinct from old.number and new.is_active is not distinct from old.is_active then
      return new;
    end if;
    v_old := jsonb_build_object('number', old.number, 'is_active', old.is_active);
    v_new := jsonb_build_object('number', new.number, 'is_active', new.is_active);
  else
    if new.name is not distinct from old.name and new.is_active is not distinct from old.is_active then
      return new;
    end if;
    v_old := jsonb_build_object('name', old.name, 'is_active', old.is_active);
    v_new := jsonb_build_object('name', new.name, 'is_active', new.is_active);
  end if;
  -- target_id uuid لا يناسب مفاتيح int: المعرّف والجدول داخل before/after
  insert into public.admin_audit (actor, action, before, after)
  values (auth.uid(), 'address',
          v_old || jsonb_build_object('table', tg_table_name, 'id', old.id),
          v_new || jsonb_build_object('table', tg_table_name, 'id', new.id));
  return new;
end
$$;
revoke all on function public.tg_audit_address_change() from public, anon, authenticated;

create trigger audit_sectors_change after update of name, is_active on public.sectors
  for each row execute function public.tg_audit_address_change();
create trigger audit_subsections_change after update of name, is_active on public.subsections
  for each row execute function public.tg_audit_address_change();
create trigger audit_buildings_change after update of number, is_active on public.buildings
  for each row execute function public.tg_audit_address_change();
