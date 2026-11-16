-- =====================================================================
-- T19: الإعدادات والموظفون والعناوين (SPEC-backend §12.2؛ SPEC-admin §2.4، §2.6، §2.7)
--   1) update_app_settings (أدمن) وسحب الـ update المباشر على app_settings.
--      قيد min_order_iqd % 250 = 0 موجود أصلاً (app_settings_min_order_multiple_250، 20261111000002).
--   2) stuck_notifications_count (أدمن): إشعارات غير مرسلة أقدم من 5 دقائق (مؤشر الإعدادات).
--   3) تدقيق: pin_resets (admin-reset-pin) وuser_creations (admin-create-user)، قراءة للأدمن فقط.
--   4) دوال service_role للدالتين: عدّاد الساعة، تسجيل إعادة الضبط، وإكمال إنشاء الحساب بمعاملة.
--   5) add_buildings (أدمن): عمارات بالجملة لوحدة، المكرر يُتجاهل (on conflict do nothing).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الإعدادات عبر دالة
-- ---------------------------------------------------------------------
create function public.update_app_settings(p jsonb)
returns public.app_settings
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_row  public.app_settings;
  v_key  text;
  v_num  numeric;
  v_msg  text;
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

  select * into v_row from public.app_settings where id = 1 for update;

  -- المبالغ: أعداد صحيحة ≥ 0 من مضاعفات 250
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

  update public.app_settings set
    delivery_fee_iqd  = case when p ? 'delivery_fee_iqd'  then (p ->> 'delivery_fee_iqd')::bigint else delivery_fee_iqd end,
    min_order_iqd     = case when p ? 'min_order_iqd'     then (p ->> 'min_order_iqd')::bigint else min_order_iqd end,
    max_active_orders = case when p ? 'max_active_orders' then (p ->> 'max_active_orders')::int else max_active_orders end,
    store_open        = case when p ? 'store_open'        then (p ->> 'store_open')::boolean else store_open end,
    closed_message    = case when p ? 'closed_message'    then v_msg else closed_message end
  where id = 1
  returning * into v_row;
  return v_row;
end
$$;

revoke all on function public.update_app_settings(jsonb) from public, anon;
grant execute on function public.update_app_settings(jsonb) to authenticated;

-- لا update مباشر بعد الآن (القراءة تبقى للجميع)
drop policy settings_admin on public.app_settings;
revoke update on public.app_settings from authenticated;
revoke update (delivery_fee_iqd, min_order_iqd, store_open, closed_message, max_active_orders)
  on public.app_settings from authenticated;

-- ---------------------------------------------------------------------
-- 2) مؤشر الإشعارات العالقة
-- ---------------------------------------------------------------------
create function public.stuck_notifications_count()
returns integer
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return (select count(*)::int from public.notification_outbox
           where sent_at is null and created_at < now() - interval '5 minutes');
end
$$;

revoke all on function public.stuck_notifications_count() from public, anon;
grant execute on function public.stuck_notifications_count() to authenticated;

-- ---------------------------------------------------------------------
-- 3) جداول التدقيق (بلا الرمز أبداً)
-- ---------------------------------------------------------------------
create table public.pin_resets (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete set null,
  reset_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index pin_resets_by_idx on public.pin_resets (reset_by, created_at desc);
create index pin_resets_user_idx on public.pin_resets (user_id);

create table public.user_creations (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  role       public.user_role not null check (role in ('staff', 'driver')),
  created_at timestamptz not null default now()
);
create index user_creations_by_idx on public.user_creations (created_by, created_at desc);
create index user_creations_user_idx on public.user_creations (user_id);

alter table public.pin_resets     enable row level security;
alter table public.user_creations enable row level security;
create policy pin_resets_admin_read     on public.pin_resets     for select to authenticated
  using ((select private.is_admin()));
create policy user_creations_admin_read on public.user_creations for select to authenticated
  using ((select private.is_admin()));

revoke all on public.pin_resets, public.user_creations from public, anon, authenticated, service_role;
grant select on public.pin_resets, public.user_creations to authenticated;

-- ---------------------------------------------------------------------
-- 4) دوال service_role (Edge Functions admin-reset-pin وadmin-create-user)
-- ---------------------------------------------------------------------
-- عدد العمليات لأدمن خلال آخر ساعة (حد 20/ساعة لكل أدمن، من سجل التدقيق)
create function public.admin_actions_last_hour(p_kind text, p_admin uuid)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_kind = 'pin_reset' then
    return (select count(*)::int from public.pin_resets
             where reset_by = p_admin and created_at > now() - interval '1 hour');
  elsif p_kind = 'user_creation' then
    return (select count(*)::int from public.user_creations
             where created_by = p_admin and created_at > now() - interval '1 hour');
  end if;
  raise exception 'INVALID_REQUEST' using errcode = 'P0001';
end
$$;

create function public.record_pin_reset(p_user_id uuid, p_reset_by uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  insert into public.pin_resets (user_id, reset_by) values (p_user_id, p_reset_by);
$$;

-- بعد auth.admin.createUser (الـ trigger أنشأ ملفاً بدور customer): الاسم والدور والتدقيق بمعاملة واحدة.
create function public.finish_user_creation(p_user_id uuid, p_created_by uuid,
                                            p_role public.user_role, p_full_name text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_role not in ('staff', 'driver') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  update public.profiles
     set role = p_role, is_active = true, full_name = nullif(btrim(p_full_name), '')
   where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into public.user_creations (user_id, created_by, role) values (p_user_id, p_created_by, p_role);
end
$$;

revoke all on function public.admin_actions_last_hour(text, uuid) from public, anon, authenticated;
revoke all on function public.record_pin_reset(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_user_creation(uuid, uuid, public.user_role, text) from public, anon, authenticated;
grant execute on function public.admin_actions_last_hour(text, uuid) to service_role;
grant execute on function public.record_pin_reset(uuid, uuid) to service_role;
grant execute on function public.finish_user_creation(uuid, uuid, public.user_role, text) to service_role;

-- ---------------------------------------------------------------------
-- 5) عمارات بالجملة لوحدة
-- ---------------------------------------------------------------------
create function public.add_buildings(p_subsection_id int, p_numbers text[])
returns integer
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_numbers is null or cardinality(p_numbers) = 0 or cardinality(p_numbers) > 500
     or exists (select 1 from unnest(p_numbers) n where n is null or n !~ '^[1-9][0-9]{0,3}$') then
    raise exception 'INVALID_BUILDINGS' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.subsections where id = p_subsection_id) then
    raise exception 'INVALID_BUILDINGS' using errcode = 'P0001', detail = 'subsection';
  end if;

  insert into public.buildings (subsection_id, number, sort_order)
  select p_subsection_id, n, n::int
    from (select distinct n from unnest(p_numbers) n) s
  on conflict (subsection_id, number) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.add_buildings(int, text[]) from public, anon;
grant execute on function public.add_buildings(int, text[]) to authenticated;
