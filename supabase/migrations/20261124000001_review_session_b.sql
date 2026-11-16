-- مراجعة T16-T19، جلسة الإصلاح B (docs/reviews/review-T16-T19.md):
--   1) M4: pin_resets.kind ('admin' | 'break_glass') + record_pin_reset(kind): سكربت الطوارئ المحلي
--      (scripts/admin-break-glass.mjs) يسجّل بلا reset_by، ويضبط must_change_pin كإعادة ضبط اللوحة.
--   2) L3: حد المعدل يحسب كل المحاولات (لا الناجحة فقط): admin_function_hits + admin_rate_hit.
--   3) M5: الإشعارات "العالقة" = قابلة لإعادة المحاولة فقط (attempts < 5)؛ الفاشلة نهائياً تُعدّ
--      منفصلة ويصرفها الأدمن (dismissed_at، يُسجَّل بـ admin_audit).
--   4) M7: عمارة 1..100 بفحص قاعدة البيانات؛ لا تعديل لـ id/الأب ولا حذف لجداول العناوين؛
--      address_usage: عدد العناوين المحفوظة التي ستتأثر بإعادة التسمية.
--   5) L2: الدوال المعاد كتابتها هنا بـ search_path = '' وأسماء كاملة.
-- لا تعديل لـ migration قديمة؛ لا تغيير بالقواعد الأخرى.

-- ---------------------------------------------------------------------
-- 1) pin_resets.kind + record_pin_reset
-- ---------------------------------------------------------------------
alter table public.pin_resets
  add column kind text not null default 'admin' check (kind in ('admin', 'break_glass'));
comment on column public.pin_resets.kind is
  'admin = admin-reset-pin (reset_by = the admin); break_glass = scripts/admin-break-glass.mjs run by the project owner (reset_by null).';

drop function public.record_pin_reset(uuid, uuid);
create function public.record_pin_reset(p_user_id uuid, p_reset_by uuid, p_kind text default 'admin')
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_kind not in ('admin', 'break_glass') then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  insert into public.pin_resets (user_id, reset_by, kind) values (p_user_id, p_reset_by, p_kind);
  update public.profiles set must_change_pin = true where id = p_user_id;
end
$$;
revoke all on function public.record_pin_reset(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_pin_reset(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 2) حد المعدل: كل محاولة تُحسب (create-user وreset-pin)، بقفل لكل أدمن فلا تجاوز بالتزامن
-- ---------------------------------------------------------------------
create table public.admin_function_hits (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('pin_reset', 'user_creation')),
  admin_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index admin_function_hits_idx on public.admin_function_hits (kind, admin_id, created_at desc);
create index admin_function_hits_created_idx on public.admin_function_hits (created_at);
alter table public.admin_function_hits enable row level security;
revoke all on public.admin_function_hits from public, anon, authenticated, service_role;

create function public.admin_rate_hit(p_kind text, p_admin uuid)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_kind not in ('pin_reset', 'user_creation') or p_admin is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_rate:' || p_kind || ':' || p_admin::text, 0));
  delete from public.admin_function_hits where created_at < now() - interval '1 day';
  insert into public.admin_function_hits (kind, admin_id) values (p_kind, p_admin);
  select count(*)::int into v_count from public.admin_function_hits
   where kind = p_kind and admin_id = p_admin and created_at > now() - interval '1 hour';
  return v_count;
end
$$;
revoke all on function public.admin_rate_hit(text, uuid) from public, anon, authenticated;
grant execute on function public.admin_rate_hit(text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3) الإشعارات: عالقة (قابلة لإعادة المحاولة) / فاشلة نهائياً / مصروفة
-- ---------------------------------------------------------------------
alter table public.notification_outbox add column dismissed_at timestamptz;
comment on column public.notification_outbox.dismissed_at is
  'Admin acknowledged a permanently failed row (attempts = 5, never sent); excluded from the failed count.';

alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check
  check (action in ('user_role', 'settings', 'order_driver', 'notifications_dismissed'));

drop function public.stuck_notifications_count();
-- عالقة = لم تُرسل، ما زالت قابلة لإعادة المحاولة (attempts < 5)، وأقدم من 5 دقائق: المرسِل متوقف أو بطيء.
create function public.stuck_notifications_count()
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return (select count(*)::int from public.notification_outbox
           where sent_at is null and attempts < 5 and dismissed_at is null
             and created_at < now() - interval '5 minutes');
end
$$;

-- فاشلة نهائياً = استنفدت المحاولات (5) ولم تُرسل ولم يصرفها الأدمن: رمز تالف أو خلل دائم، لا تعني توقف المرسِل.
create function public.failed_notifications_count()
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return (select count(*)::int from public.notification_outbox
           where sent_at is null and attempts >= 5 and dismissed_at is null);
end
$$;

create function public.dismiss_failed_notifications()
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (select private.is_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.notification_outbox set dismissed_at = now()
   where sent_at is null and attempts >= 5 and dismissed_at is null;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.admin_audit (actor, action, before, after)
    values ((select auth.uid()), 'notifications_dismissed', '{}'::jsonb, jsonb_build_object('count', v_count));
  end if;
  return v_count;
end
$$;

revoke all on function public.stuck_notifications_count() from public, anon;
revoke all on function public.failed_notifications_count() from public, anon;
revoke all on function public.dismiss_failed_notifications() from public, anon;
grant execute on function public.stuck_notifications_count() to authenticated;
grant execute on function public.failed_notifications_count() to authenticated;
grant execute on function public.dismiss_failed_notifications() to authenticated;

-- ---------------------------------------------------------------------
-- 4) العناوين: صيغة العمارة، صلاحيات أضيق، عدد العناوين المتأثرة
-- ---------------------------------------------------------------------
-- 1..100 داخل كل وحدة (CLAUDE.md). تُفحص بيانات التطوير قبل التطبيق (1700 عمارة، كلها مطابقة).
alter table public.buildings
  add constraint buildings_number_format check (number ~ '^([1-9][0-9]?|100)$');

-- الإدارة بالواجهة: الاسم/الرقم والإخفاء والترتيب فقط. لا تغيير للأب (يحرّك العناوين المحفوظة)، ولا حذف (الإخفاء بديله).
revoke update, delete on public.sectors, public.subsections, public.buildings from authenticated;
grant update (name, sort_order, is_active) on public.sectors to authenticated;
grant update (name, sort_order, is_active) on public.subsections to authenticated;
grant update (number, sort_order, is_active) on public.buildings to authenticated;

create or replace function public.add_buildings(p_subsection_id int, p_numbers text[])
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (select private.is_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_numbers is null or cardinality(p_numbers) = 0 or cardinality(p_numbers) > 500
     or exists (select 1 from unnest(p_numbers) n where n is null or n !~ '^([1-9][0-9]?|100)$') then
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

-- عدد عناوين الزبائن المحفوظة تحت قطاع/وحدة/عمارة: إعادة التسمية تغيّر نصها عندهم كلهم.
create function public.address_usage(p_kind text, p_id int)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_kind = 'buildings' then
    return (select count(*)::int from public.addresses a where a.building_id = p_id);
  elsif p_kind = 'subsections' then
    return (select count(*)::int from public.addresses a
              join public.buildings b on b.id = a.building_id where b.subsection_id = p_id);
  elsif p_kind = 'sectors' then
    return (select count(*)::int from public.addresses a
              join public.buildings b on b.id = a.building_id
              join public.subsections s on s.id = b.subsection_id where s.sector_id = p_id);
  end if;
  raise exception 'INVALID_REQUEST' using errcode = 'P0001';
end
$$;

revoke all on function public.address_usage(text, int) from public, anon;
grant execute on function public.address_usage(text, int) to authenticated;
