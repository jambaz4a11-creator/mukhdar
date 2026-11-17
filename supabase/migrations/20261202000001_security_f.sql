-- =====================================================================
-- جلسة الإصلاح F (docs/reviews/review-E1-E2.md؛ قرارات المالك 2026-11-17):
--   H1) إشعارات الأدمن/الموظف تتطلب aal2: register_push_token يرفض جلسة أدمن/موظف بلا دور فعّال (aal1 أو
--       خاملة 12 ساعة) بـ MFA_REQUIRED، والرمز يُربط بجلسته (push_tokens.session_id)؛ claim_push_notifications لا
--       يسلّم لرمز أدمن/موظف إلا وجلسته موجودة بـ aal2 وغير خاملة. رموز الأدمن/الموظف الحالية تُحذف. إعادة ضبط
--       المصادقة الثنائية تحذف رموز الحساب.
--   M1) التقييمات للموظف: آخر 7 أيام بغداد فقط (ratings_list، ratings_summary، سياسة ratings_read)؛ الأدمن بلا حد.
--   M2) لا "أول من يسجّل يربح": ترقية زبون/سائق إلى موظف/أدمن تتطلب رمزاً مؤقتاً من الأدمن أولاً (PIN_RESET_REQUIRED)
--       وتمسح أي عامل TOTP سابق؛ profiles.pin_reset_at يُضبط مع كل رمز مؤقت، وعند تغيير الرمز المؤقت لحساب أدمن/موظف
--       يُحذف أي عامل سُجّل بعد pin_reset_at (أي قبل تغيير الرمز). اللوحة: تغيير الرمز أولاً ثم تسجيل التطبيق.
--   M3) حد قيمة الطلب: app_settings.max_order_iqd (200,000) وnew_account_max_order_iqd (50,000 حتى أول طلب مُسلَّم)،
--       على مجموع الطلب مع التوصيل. place_order: ORDER_TOO_LARGE / NEW_ACCOUNT_ORDER_LIMIT (detail = الحد).
--   M4) public.panel_session_alive(): قراءة فقط (لا تحدّث النشاط) لتعرف اللوحة أن الجلسة انتهت بالخمول.
--   L3) private.deployment: علامة البيئة داخل قاعدة البيانات. سكربتات البيانات التجريبية (seed:*، it:*) تعمل فقط
--       على قاعدة فيها env = 'dev' (محلياً بـ seed.sql، وعلى mukhdar-dev مرة واحدة يدوياً). الإنتاج لا يُعلَّم أبداً.
--   L4) "إلغاء كل الطلبات + تعطيل" لا يلمس طلباً بالطريق (out_for_delivery): يُرجعه بالقائمة ليقرر الأدمن.
--   L5) حذف الحساب يمحو أيضاً سبب الإلغاء وملاحظة السجل التي كتبها الزبون وإشعارات طلباته؛ سبب الإلغاء يُنظَّف (L3).
--   L6) التنظيف اليومي يحذف جلسات اللوحة الخاملة > 12 ساعة (auth.sessions).
--   L7) حساب الموظف لا يُحذف ذاتياً (مثل الأدمن: ADMIN_ACCOUNT).
--   L8) admin_cancel_customer_orders يقفل صفوف الأدمن قبل الهدف (نفس ترتيب set_user_role).
-- =====================================================================

-- ---------------------------------------------------------------------
-- L3) علامة البيئة (صف واحد). الـ migration لا تضيف صفاً: 'dev' يُضاف محلياً (seed.sql) وعلى mukhdar-dev يدوياً
-- (RUNBOOK §17.2)، والإنتاج يبقى بلا صف فترفضه السكربتات حتى لو أخطأت قوائم المراجع.
-- ---------------------------------------------------------------------
create table private.deployment (
  id  boolean primary key default true check (id),
  env text not null check (env in ('dev', 'staging', 'production'))
);
alter table private.deployment enable row level security;
revoke all on private.deployment from public, anon, authenticated;
comment on table private.deployment is
  'Environment marker (T23 F, L3). ''dev'' on local (seed.sql) and mukhdar-dev (inserted by hand once); never set on production. Demo/test data scripts (seed:*, it:*) run only where env = ''dev''.';

-- ---------------------------------------------------------------------
-- H1) الإشعارات بجلسة aal2
-- ---------------------------------------------------------------------
alter table public.push_tokens add column session_id uuid;
comment on column public.push_tokens.session_id is
  'Auth session that registered the token (admin/staff only, T23 F H1): pushes go to it only while that session is aal2 and not idle.';

-- رمز أدمن/موظف يستلم فقط وجلسته حيّة بـ aal2 وغير خاملة (نفس قاعدة current_user_role). خدمة الإشعارات (service_role).
create function private.panel_push_session_ok(p_session_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_session_id is not null
     and exists (select 1 from auth.sessions s
                  where s.id = p_session_id and s.aal::text = 'aal2'
                    and (s.not_after is null or s.not_after > now()))
     and not exists (select 1 from private.panel_sessions ps
                      where ps.session_id = p_session_id and ps.last_seen < now() - interval '12 hours')
$$;
revoke all on function private.panel_push_session_ok(uuid) from public, anon, authenticated;
grant execute on function private.panel_push_session_ok(uuid) to service_role;

-- نسخة 20261201000001 + الأدمن/الموظف: دور فعّال (aal2، غير خامل) وإلا MFA_REQUIRED؛ الرمز يحمل الجلسة.
create or replace function public.register_push_token(
  p_token    text,
  p_platform public.push_platform,
  p_provider public.push_provider default 'expo'
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role    public.user_role;
  v_flag    boolean;
  v_session uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select role, must_change_pin into v_role, v_flag from public.profiles where id = auth.uid();
  if v_flag then
    raise exception 'PIN_CHANGE_REQUIRED' using errcode = '42501';
  end if;
  if v_role in ('admin', 'staff') then
    if private.current_user_role() is null then
      raise exception 'MFA_REQUIRED' using errcode = '42501';
    end if;
    v_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
    if v_session is null then
      raise exception 'MFA_REQUIRED' using errcode = '42501';
    end if;
  end if;
  if p_platform is null or p_provider is null
     or nullif(btrim(p_token), '') is null or char_length(p_token) > 255
     or (p_provider = 'expo' and p_token !~ '^Expo(nent)?PushToken\[[^\]]+\]$') then
    raise exception 'INVALID_TOKEN' using errcode = 'P0001';
  end if;
  insert into public.push_tokens (user_id, token, platform, provider, session_id)
  values (auth.uid(), p_token, p_platform, p_provider, v_session)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, provider = excluded.provider,
        session_id = excluded.session_id, last_seen_at = now();

  -- L2: أحدث 5 رموز فقط لكل مستخدم (الأقدم نشاطاً يُحذف)
  delete from public.push_tokens t
   where t.user_id = auth.uid()
     and t.id in (select id from public.push_tokens
                   where user_id = auth.uid()
                   order by last_seen_at desc, id desc
                   offset 5);
end
$$;

-- نسخة 20261125000001 + رموز الأدمن/الموظف بجلسة aal2 حيّة فقط
create or replace function public.claim_push_notifications(p_limit integer default 200)
returns table(id bigint, title text, body text, data jsonb, attempts integer, recipients jsonb)
-- definer (كانت invoker): تقرأ auth.sessions وprivate.panel_sessions عبر private.panel_push_session_ok؛
-- التنفيذ ما زال لـ service_role فقط (المنح محفوظة مع create or replace).
language sql security definer set search_path = ''
as $$
  with picked as (
    select o.id
      from public.notification_outbox o
     where o.sent_at is null and o.attempts < 5
       and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
     order by o.created_at, o.id
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
       for update skip locked
  ), claimed as (
    update public.notification_outbox o set claimed_at = now()
      from picked where o.id = picked.id
    returning o.id, o.audience, o.user_id, o.title, o.body, o.data, o.attempts
  )
  select c.id, c.title, c.body, c.data, c.attempts,
         coalesce((select jsonb_agg(jsonb_build_object('token', t.token, 'provider', t.provider,
                                                       'platform', t.platform) order by t.id)
                     from public.push_tokens t
                     join public.profiles p on p.id = t.user_id
                    where p.is_active
                      and not p.must_change_pin   -- H1: رمز مؤقت لم يُغيَّر ← لا إشعارات
                      -- T23 F H1: الأدمن/الموظف بجلسة aal2 حيّة فقط (لا PIN وحده، ولا جلسة خاملة أو محذوفة)
                      and (p.role not in ('admin', 'staff') or private.panel_push_session_ok(t.session_id))
                      and case c.audience
                            when 'user'        then t.user_id = c.user_id
                            when 'drivers'     then p.role = 'driver'
                            when 'admins'      then p.role in ('admin', 'staff')
                            when 'admins_only' then p.role = 'admin'
                            else false
                          end), '[]'::jsonb)
    from claimed c
   order by c.id
$$;

-- رموز الأدمن/الموظف الحالية سُجّلت بلا جلسة (أو بجلسة aal1): تُحذف، والتسجيل من جديد بجلسة aal2
delete from public.push_tokens t using public.profiles p
 where p.id = t.user_id and p.role in ('admin', 'staff');

-- إعادة ضبط المصادقة الثنائية (لوحة/طوارئ/ترقية): + حذف رموز الإشعارات (نسخة 20261130000001)
create or replace function private.reset_mfa_factors(p_user_id uuid, p_actor uuid, p_via text)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_role public.user_role;
  v_n    integer;
begin
  select role into v_role from public.profiles where id = p_user_id;
  delete from auth.mfa_factors where user_id = p_user_id;
  get diagnostics v_n = row_count;
  perform public.revoke_user_sessions(p_user_id);
  delete from public.push_tokens where user_id = p_user_id;
  insert into public.admin_audit (actor, action, target_id, before, after)
  values (p_actor, 'mfa_reset', p_user_id,
          jsonb_build_object('factors', v_n, 'role', v_role),
          jsonb_build_object('factors', 0, 'via', p_via));
  return v_n;
end
$$;
revoke all on function private.reset_mfa_factors(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- M1) التقييمات: الموظف آخر 7 أيام بغداد
-- ---------------------------------------------------------------------
-- بداية نافذة الموظف (اليوم + 6 أيام قبله، بغداد)؛ null للأدمن. نفس حد orders_read.
create function private.staff_window_start()
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select case when private.is_admin() then null
              else private.baghdad_start(public.baghdad_today() - 6) end
$$;
revoke all on function private.staff_window_start() from public, anon, authenticated, service_role;

create or replace function public.ratings_list(
  p_from date default null, p_to date default null, p_min_stars integer default 1, p_max_stars integer default 5,
  p_with_comment boolean default false, p_before_created timestamptz default null, p_before_order uuid default null,
  p_limit integer default 50)
returns table(order_id uuid, order_number bigint, customer_name text, stars smallint, comment text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_floor timestamptz;
begin
  perform private.ratings_guard(p_from, p_to, p_min_stars, p_max_stars);
  v_floor := private.staff_window_start();   -- T23 F M1
  return query
    select r.order_id, o.order_number,
           case when r.customer_id is null then null else o.customer_name end,
           r.stars, r.comment, r.created_at
      from public.ratings r
      join public.orders o on o.id = r.order_id
     where (p_from is null or r.created_at >= private.baghdad_start(p_from))
       and (p_to   is null or r.created_at <  private.baghdad_start(p_to + 1))
       and (v_floor is null or r.created_at >= v_floor)
       and r.stars between p_min_stars and p_max_stars
       and (not coalesce(p_with_comment, false) or r.comment is not null)
       and (p_before_created is null or p_before_order is null
            or (r.created_at, r.order_id) < (p_before_created, p_before_order))
     order by r.created_at desc, r.order_id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

create or replace function public.ratings_summary(
  p_from date default null, p_to date default null, p_min_stars integer default 1, p_max_stars integer default 5,
  p_with_comment boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_floor timestamptz;
  v_from  timestamptz;
begin
  perform private.ratings_guard(p_from, p_to, p_min_stars, p_max_stars);
  v_floor := private.staff_window_start();   -- T23 F M1
  v_from := case when p_from is not null then private.baghdad_start(p_from) end;
  if v_floor is not null then
    v_from := greatest(coalesce(v_from, v_floor), v_floor);
  end if;
  return private.ratings_stats(
           v_from,
           case when p_to is not null then private.baghdad_start(p_to + 1) end,
           p_min_stars, p_max_stars, coalesce(p_with_comment, false));
end
$$;

drop policy ratings_read on public.ratings;
create policy ratings_read on public.ratings for select to authenticated using (
  customer_id = (select auth.uid())
  or (select private.is_admin())
  or ((select private.is_staff_or_admin())
      and created_at >= (((select public.baghdad_today()) - 6)::timestamp at time zone 'Asia/Baghdad')));

-- ---------------------------------------------------------------------
-- M2) الرمز المؤقت قبل المصادقة الثنائية
-- ---------------------------------------------------------------------
alter table public.profiles add column pin_reset_at timestamptz;
comment on column public.profiles.pin_reset_at is
  'When must_change_pin was last set (temporary PIN, T23 F M2). TOTP factors created after it and before the PIN change are removed at the PIN change (admin/staff).';
update public.profiles set pin_reset_at = now() where must_change_pin;

create function private.tg_profiles_pin_reset_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.must_change_pin and (tg_op = 'INSERT' or not old.must_change_pin) then
    new.pin_reset_at := now();
  end if;
  return new;
end
$$;
revoke all on function private.tg_profiles_pin_reset_at() from public, anon, authenticated, service_role;

create trigger profiles_pin_reset_at
  before insert or update of must_change_pin on public.profiles
  for each row execute function private.tg_profiles_pin_reset_at();

-- تغيير كلمة السر يمسح must_change_pin (نسخة 20261123000001) + T23 F M2: حساب أدمن/موظف غيّر رمزه المؤقت ←
-- أي عامل TOTP سُجّل أثناء الرمز المؤقت (بعد pin_reset_at) يُحذف: التسجيل يأتي بعد تغيير الرمز فقط.
create or replace function public.tg_auth_pin_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role  public.user_role;
  v_since timestamptz;
  v_n     integer;
begin
  update public.profiles set must_change_pin = false
   where id = new.id and must_change_pin
  returning role, pin_reset_at into v_role, v_since;
  if found and v_role in ('admin', 'staff') then
    delete from auth.mfa_factors
     where user_id = new.id and created_at >= coalesce(v_since, '-infinity'::timestamptz);
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into public.admin_audit (actor, action, target_id, before, after)
      values (null, 'mfa_reset', new.id, jsonb_build_object('factors', v_n, 'role', v_role),
              jsonb_build_object('via', 'temporary_pin_window'));
    end if;
  end if;
  return null;
end
$$;

-- set_user_role: نسخة 20261125000001 + T23 F M2: ترقية زبون/سائق إلى موظف/أدمن تتطلب رمزاً مؤقتاً (أعد الضبط أولاً)،
-- وتمسح أي عامل TOTP سابق (وتبطل الجلسات وتحذف رموز الإشعارات، مُدقَّقة mfa_reset via promotion).
create or replace function public.set_user_role(p_user_id uuid, p_role public.user_role, p_is_active boolean default true)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_old     public.profiles;
  v_orders  text;
  v_rank    constant jsonb := '{"customer": 0, "driver": 1, "staff": 2, "admin": 3}';
  v_promote boolean;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_role is null or p_is_active is null then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid and (p_role <> 'admin' or not p_is_active) then
    raise exception 'CANNOT_DEMOTE_SELF' using errcode = 'P0001';
  end if;

  -- تغييرات الأدمن متسلسلة: أدمنان يزيلان بعضهما بنفس اللحظة لا يتركان النظام بلا أدمن.
  perform 1 from public.profiles where role = 'admin' and is_active order by id for update;
  if not exists (select 1 from public.profiles
                  where id = v_uid and role = 'admin' and is_active and not must_change_pin) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- قفل الهدف: accept_order وassign_driver يقفلان ملف السائق for share، فلا يُسند له طلب أثناء تعطيله.
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old.role = p_role and v_old.is_active = p_is_active then
    return;  -- لا تغيير، لا تدقيق
  end if;

  v_promote := v_old.role in ('customer', 'driver') and p_role in ('staff', 'admin');
  if v_promote and not v_old.must_change_pin then
    raise exception 'PIN_RESET_REQUIRED' using errcode = 'P0001';
  end if;

  if v_old.role = 'admin' and v_old.is_active and (p_role <> 'admin' or not p_is_active)
     and not exists (select 1 from public.profiles
                      where role = 'admin' and is_active and id <> p_user_id) then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;

  if v_old.role = 'driver' and (p_role <> 'driver' or not p_is_active) then
    select string_agg('#' || o.order_number, '، ' order by o.order_number) into v_orders
      from public.orders o
     where o.driver_id = p_user_id and o.status in ('preparing', 'ready', 'out_for_delivery');
    if v_orders is not null then
      raise exception 'DRIVER_HAS_ORDERS' using errcode = 'P0001', detail = v_orders;
    end if;
  end if;

  update public.profiles set role = p_role, is_active = p_is_active where id = p_user_id;

  insert into public.admin_audit (actor, action, target_id, before, after)
  values (v_uid, 'user_role', p_user_id,
          jsonb_build_object('role', v_old.role, 'is_active', v_old.is_active),
          jsonb_build_object('role', p_role, 'is_active', p_is_active));

  if v_promote then
    -- عامل سجّله الزبون/السائق (أو من استولى على حسابه) لا ينتقل لحساب الإدارة
    if exists (select 1 from auth.mfa_factors where user_id = p_user_id) then
      perform private.reset_mfa_factors(p_user_id, v_uid, 'promotion');
    end if;
    delete from public.push_tokens where user_id = p_user_id;
  end if;

  -- التعطيل أو تخفيض الدور: كل الأجهزة تخرج (إعادة التفعيل تتطلب دخولاً جديداً بالرمز).
  if (v_old.is_active and not p_is_active)
     or (v_rank ->> p_role::text)::int < (v_rank ->> v_old.role::text)::int then
    perform public.revoke_user_sessions(p_user_id);
    delete from public.push_tokens where user_id = p_user_id;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- M3) حد قيمة الطلب
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column max_order_iqd bigint not null default 200000
    constraint app_settings_max_order_iqd_range
      check (max_order_iqd between 250 and 100000000 and max_order_iqd % 250 = 0),
  add column new_account_max_order_iqd bigint not null default 50000
    constraint app_settings_new_account_max_order_iqd_range
      check (new_account_max_order_iqd between 250 and 100000000 and new_account_max_order_iqd % 250 = 0);
comment on column public.app_settings.max_order_iqd is
  'Max order total (subtotal + delivery fee) in IQD for every customer (T23 F M3). Default 200,000.';
comment on column public.app_settings.new_account_max_order_iqd is
  'Max order total for a customer with no delivered order yet (T23 F M3). Default 50,000; the smaller of the two applies.';

-- update_app_settings: نسخة 20261201000001 + المفتاحان الجديدان (مبالغ من مضاعفات 250، 250..100,000,000)
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
                     'max_order_iqd', 'new_account_max_order_iqd') then
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
    max_order_iqd     = case when p ? 'max_order_iqd'     then (p ->> 'max_order_iqd')::numeric::bigint else max_order_iqd end,
    new_account_max_order_iqd =
      case when p ? 'new_account_max_order_iqd' then (p ->> 'new_account_max_order_iqd')::numeric::bigint
           else new_account_max_order_iqd end,
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

-- place_order: نسخة 20261201000001 + حد قيمة الطلب (M3) بعد التسعير، تحت نفس قفل الزبون.
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
  v_new      boolean;
  v_total    bigint;
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

  -- الملف الذي قرأناه قبل القفل قد يكون قديماً: التعطيل (admin_cancel_customer_orders، حذف الحساب) يجري تحت نفس القفل
  perform 1 from public.profiles where id = v_uid and is_active and role = 'customer' and not must_change_pin;
  if not found then
    raise exception 'NOT_CUSTOMER' using errcode = '42501';
  end if;

  select * into v_settings from public.app_settings where id = 1;

  -- حساب بلا طلب مُسلَّم بعد: حدّا الحساب الجديد (عدد الطلبات المفتوحة، وقيمة الطلب M3)
  v_new := not exists (select 1 from public.orders where customer_id = v_uid and status = 'delivered');
  v_limit := v_settings.max_active_orders;
  if v_new then
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

  -- M3 (T23 F): مجموع الطلب (مع التوصيل) ≤ الحد؛ الحساب الجديد بالأصغر من الحدين
  v_total := v_subtotal + v_settings.delivery_fee_iqd;
  if v_new and v_settings.new_account_max_order_iqd < v_settings.max_order_iqd
     and v_total > v_settings.new_account_max_order_iqd then
    raise exception 'NEW_ACCOUNT_ORDER_LIMIT' using errcode = 'P0001',
          detail = v_settings.new_account_max_order_iqd::text;
  end if;
  if v_total > v_settings.max_order_iqd then
    raise exception 'ORDER_TOO_LARGE' using errcode = 'P0001', detail = v_settings.max_order_iqd::text;
  end if;

  -- ملاحظة الطلب: نص صرف (L3)؛ الطول بعد التنظيف ≤ 300 (قيد الجدول)
  v_note := private.clean_user_text(p_note);

  insert into public.orders (customer_id, address_id, address_snapshot, customer_name, customer_phone,
                             subtotal_iqd, delivery_fee_iqd, total_iqd, note, idempotency_key)
  values (v_uid, p_address_id, v_address, v_profile.full_name, v_profile.phone,
          v_subtotal, v_settings.delivery_fee_iqd, v_total,
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
-- M4) هل جلسة اللوحة حيّة؟ (قراءة فقط: لا تحدّث النشاط، فالاستطلاع لا يمدد الجلسة)
-- ---------------------------------------------------------------------
create function public.panel_session_alive()
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select coalesce(private.current_user_role() in ('admin', 'staff'), false)
$$;
comment on function public.panel_session_alive() is
  'Panel poll (T23 F M4): true while the caller is an active admin/staff with an aal2 session idle < 12 h. Never updates activity.';
revoke all on function public.panel_session_alive() from public, anon;
grant execute on function public.panel_session_alive() to authenticated;

-- ---------------------------------------------------------------------
-- L5) set_order_status: سبب الإلغاء نص صرف (نسخة 20261125000001 + private.clean_user_text)
-- ---------------------------------------------------------------------
create or replace function public.set_order_status(p_order_id uuid, p_status public.order_status, p_reason text default null,
                                                   p_return_stock boolean default true)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role := public.current_user_role();
  v_order   public.orders;
  v_prev    public.order_status;
  v_allowed boolean;
  v_cost    bigint;
  v_reason  text := left(private.clean_user_text(p_reason), 300);
  v_return  boolean := coalesce(p_return_stock, true);
begin
  if v_uid is null or v_role is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_prev := v_order.status;

  if not ((v_prev = 'pending'          and p_status in ('preparing', 'cancelled'))
       or (v_prev = 'preparing'        and p_status in ('ready', 'cancelled'))
       or (v_prev = 'ready'            and p_status in ('out_for_delivery', 'cancelled'))
       or (v_prev = 'out_for_delivery' and p_status in ('delivered', 'cancelled'))) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
          detail = v_prev::text || ' -> ' || p_status::text;
  end if;

  v_allowed := case v_role
    when 'admin'    then true
    -- الموظف أيضاً بالطريق/تم التوصيل: إجراءات احتياطية (تطبيق السائق معطّل أو السائق نسي)
    when 'staff'    then p_status in ('preparing', 'ready', 'out_for_delivery', 'delivered')
                         or (p_status = 'cancelled' and v_prev in ('pending', 'preparing', 'ready'))
    when 'driver'   then v_order.driver_id = v_uid and p_status in ('out_for_delivery', 'delivered')
    when 'customer' then v_order.customer_id = v_uid and v_prev = 'pending' and p_status = 'cancelled'
    else false
  end;
  if not coalesce(v_allowed, false) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- الإلغاء بلا إرجاع: الأدمن فقط، ولطلب بالطريق فقط (البضاعة طلعت مع السائق)
  if not v_return then
    if p_status <> 'cancelled' or v_prev <> 'out_for_delivery' then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_return_stock';
    end if;
    if v_role <> 'admin' then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;

  if p_status = 'out_for_delivery' and v_order.driver_id is null then
    raise exception 'NO_DRIVER_ASSIGNED' using errcode = 'P0001';
  end if;

  update public.orders set
    status              = p_status,
    preparing_at        = case when p_status = 'preparing'        then now() else preparing_at end,
    ready_at            = case when p_status = 'ready'            then now() else ready_at end,
    out_for_delivery_at = case when p_status = 'out_for_delivery' then now() else out_for_delivery_at end,
    delivered_at        = case when p_status = 'delivered'        then now() else delivered_at end,
    cancelled_at        = case when p_status = 'cancelled'        then now() else cancelled_at end,
    cancelled_by        = case when p_status = 'cancelled'        then v_uid else cancelled_by end,
    cancel_reason       = case when p_status = 'cancelled'        then v_reason else cancel_reason end
  where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_prev, p_status, v_uid, v_reason);

  if p_status = 'cancelled' then
    if v_return then
      -- إرجاع المخزون (قفل بنفس الترتيب الثابت)
      perform 1 from public.stock
       where product_id in (select product_id from public.order_items where order_id = p_order_id)
       order by product_id for update;

      update public.stock s
         set qty = s.qty + oi.qty, updated_at = now()
        from (select product_id, sum(qty)::int as qty from public.order_items
               where order_id = p_order_id and product_id is not null group by product_id) oi
       where s.product_id = oi.product_id;

      insert into public.inventory_movements (product_id, qty, type, order_id, created_by, note)
      select product_id, sum(qty)::int, 'cancel_return', p_order_id, v_uid, 'إلغاء طلب'
        from public.order_items where order_id = p_order_id and product_id is not null
       group by product_id;
    else
      -- البضاعة طلعت مع السائق: الرصيد لا يتغير. السجل يبقى مطابقاً للرصيد (cancel_return + waste بنفس
      -- الكمية)، والهدر بكلفة البنود وقت الطلب (order_item_costs) فيدخل خسائر اليوم وصافي الربح.
      insert into public.inventory_movements (product_id, qty, type, order_id, created_by, note)
      select product_id, sum(qty)::int, 'cancel_return', p_order_id, v_uid, 'إلغاء طلب بعد خروجه (بلا إرجاع)'
        from public.order_items where order_id = p_order_id and product_id is not null
       group by product_id;

      insert into public.inventory_movements (product_id, qty, type, order_id, created_by, note, unit_cost_iqd)
      select i.product_id, -sum(i.qty)::int, 'waste', p_order_id, v_uid,
             'cancelled after dispatch: أُلغي بعد خروجه مع السائق',
             coalesce(round(sum(c.cost_snapshot_iqd * i.qty)::numeric / nullif(sum(i.qty) filter (where c.cost_snapshot_iqd is not null), 0)), 0)::bigint
        from public.order_items i
        left join public.order_item_costs c on c.order_item_id = i.id
       where i.order_id = p_order_id and i.product_id is not null
       group by i.product_id;
    end if;

    perform public._bump_daily_stats(public.baghdad_today(), 0, 1, 0, 0, 0);
    perform public._notify('user', v_order.customer_id, 'تم إلغاء طلبك',
                           'الطلب #' || v_order.order_number,
                           jsonb_build_object('order_id', p_order_id, 'status', p_status))
      where v_order.customer_id is not null;
    -- السائق المعيَّن (إن لم يكن هو من ألغى) يعرف أن الطلب أُلغي
    perform public._notify('user', v_order.driver_id, 'تم إلغاء الطلب #' || v_order.order_number,
                           coalesce(v_reason, 'وحدة ' || (v_order.address_snapshot ->> 'subsection') || ' - عمارة ' || (v_order.address_snapshot ->> 'building')),
                           jsonb_build_object('order_id', p_order_id, 'type', 'cancelled', 'status', p_status))
      where v_order.driver_id is not null and v_order.driver_id <> v_uid;

  elsif p_status = 'delivered' then
    select coalesce(sum(c.cost_snapshot_iqd * i.qty), 0)::bigint into v_cost
      from public.order_items i join public.order_item_costs c on c.order_item_id = i.id
     where i.order_id = p_order_id;

    perform public._bump_daily_stats(public.baghdad_today(), 1, 0,
                                     v_order.subtotal_iqd, v_order.delivery_fee_iqd, v_cost);
    perform public._notify('user', v_order.customer_id, 'تم توصيل طلبك',
                           'شكراً لك! قيّم طلبك #' || v_order.order_number,
                           jsonb_build_object('order_id', p_order_id, 'status', p_status))
      where v_order.customer_id is not null;

  else
    perform public._notify('user', v_order.customer_id,
                           case p_status when 'preparing' then 'طلبك قيد التحضير'
                                         when 'ready'     then 'طلبك جاهز، بانتظار السائق'
                                         else 'طلبك بالطريق إليك' end,
                           'الطلب #' || v_order.order_number,
                           jsonb_build_object('order_id', p_order_id, 'status', p_status))
      where v_order.customer_id is not null;

    if p_status = 'ready' then
      -- غير معيَّن ← كل السائقين النشطين (طلب جديد متاح)؛ معيَّن مسبقاً ← سائقه فقط
      perform public._notify('drivers', null, 'طلب جديد #' || v_order.order_number,
                             'وحدة ' || (v_order.address_snapshot ->> 'subsection') || ' - عمارة ' || (v_order.address_snapshot ->> 'building'),
                             jsonb_build_object('order_id', p_order_id, 'type', 'new_order'))
        where v_order.driver_id is null;
      perform public._notify('user', v_order.driver_id, 'الطلب #' || v_order.order_number || ' جاهز للاستلام',
                             'وحدة ' || (v_order.address_snapshot ->> 'subsection') || ' - عمارة ' || (v_order.address_snapshot ->> 'building'),
                             jsonb_build_object('order_id', p_order_id, 'type', 'ready'))
        where v_order.driver_id is not null;
    end if;
  end if;

  return v_order;
end
$function$;

-- ---------------------------------------------------------------------
-- L5) محو هوية الزبون المحذوف: + سبب الإلغاء وملاحظة السجل اللذان كتبهما، وإشعارات طلباته (نسخة 20261201000001)
-- ---------------------------------------------------------------------
create or replace function private.anonymize_customer_orders(p_customer_id uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.order_status_history h
     set note = null
    from public.orders o
   where o.id = h.order_id and o.customer_id = p_customer_id
     and h.changed_by = p_customer_id and h.note is not null;

  delete from public.notification_outbox n
   where n.data ->> 'order_id' in (select o.id::text from public.orders o where o.customer_id = p_customer_id);

  update public.orders o
     set customer_name = null,
         customer_phone = null,
         note = null,
         cancel_reason = case when o.cancelled_by = p_customer_id then null else o.cancel_reason end,
         address_snapshot = jsonb_strip_nulls(jsonb_build_object(
           'sector', o.address_snapshot -> 'sector', 'subsection', o.address_snapshot -> 'subsection'))
   where o.customer_id = p_customer_id;
$$;
revoke all on function private.anonymize_customer_orders(uuid) from public, anon, authenticated, service_role;

-- من حُذفت حساباتهم سابقاً: الطلب بلا زبون ومن ألغاه حُذف أيضاً (cancelled_by null) ← السبب كتبه الزبون غالباً
update public.orders o
   set cancel_reason = null
 where o.customer_id is null and o.cancelled_by is null and o.cancel_reason is not null;
update public.order_status_history h
   set note = null
  from public.orders o
 where o.id = h.order_id and o.customer_id is null and h.changed_by is null
   and h.from_status = 'pending' and h.to_status = 'cancelled' and h.note is not null;
delete from public.notification_outbox n
 where n.data ->> 'order_id' in (select o.id::text from public.orders o where o.customer_id is null);

-- ---------------------------------------------------------------------
-- L6) التنظيف اليومي: + جلسات اللوحة الخاملة (نسخة 20261201000001)
-- ---------------------------------------------------------------------
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
  -- T23 F L6: جلسة لوحة خاملة > 12 ساعة: رموز تحديثها تُحذف (cascade يحذف صف panel_sessions)
  delete from auth.sessions s
   using private.panel_sessions p
   where p.session_id = s.id and p.last_seen < now() - interval '12 hours';
end
$$;

-- ---------------------------------------------------------------------
-- L7) حذف الحساب الذاتي: لا للأدمن ولا للموظف (نسخة 20261115000005)
-- ---------------------------------------------------------------------
create or replace function public.begin_account_deletion(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
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
  -- T23 F L7: حسابات الإدارة (أدمن وموظف) تُعطَّل من اللوحة، لا تُحذف بالـ PIN وحده
  if v_role in ('admin', 'staff') then
    raise exception 'ADMIN_ACCOUNT' using errcode = '42501';
  end if;
  if exists (select 1 from public.orders o
              where (o.customer_id = p_user_id or o.driver_id = p_user_id)
                and o.status in ('pending', 'preparing', 'ready', 'out_for_delivery')) then
    raise exception 'ACTIVE_ORDER' using errcode = 'P0001';
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
-- L4 + L8) "إلغاء كل الطلبات + تعطيل": يترك الطلب بالطريق، وترتيب الأقفال مثل set_user_role
-- ---------------------------------------------------------------------
create or replace function public.admin_cancel_customer_orders(p_user_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_target  public.profiles;
  v_order   record;
  v_cancel  int := 0;
  v_ontheway bigint[];
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- نفس قفل place_order: لا طلب يُنشأ بين الإلغاء والتعطيل
  perform pg_advisory_xact_lock(hashtextextended('place_order:' || p_user_id::text, 0));
  -- L8: صفوف الأدمن قبل صف الهدف (نفس ترتيب set_user_role) فلا deadlock مع أدمن آخر
  perform 1 from public.profiles where role = 'admin' and is_active order by id for update;

  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_target.role <> 'customer' then
    raise exception 'NOT_A_CUSTOMER' using errcode = 'P0001';
  end if;

  perform public.set_user_role(p_user_id, 'customer', false);

  -- L4 (T23 F): الطلب بالطريق لا يُلغى هنا (البضاعة مع السائق وقد ترجع): يُرجَع رقمه ليقرر الأدمن بعدها
  for v_order in
    select id, status from public.orders
     where customer_id = p_user_id and status in ('pending', 'preparing', 'ready')
     order by created_at
     for update
  loop
    perform public.set_order_status(v_order.id, 'cancelled', 'إلغاء من الأدمن: حساب موقوف');
    v_cancel := v_cancel + 1;
  end loop;

  select coalesce(array_agg(order_number order by order_number), '{}') into v_ontheway
    from public.orders where customer_id = p_user_id and status = 'out_for_delivery';

  insert into public.admin_audit (actor, action, target_id, before, after)
  values (v_uid, 'customer_lockdown', p_user_id,
          jsonb_build_object('is_active', v_target.is_active, 'open_orders', v_cancel + cardinality(v_ontheway)),
          jsonb_build_object('is_active', false, 'cancelled', v_cancel, 'left_out_for_delivery', to_jsonb(v_ontheway)));

  return jsonb_build_object('cancelled', v_cancel, 'out_for_delivery', cardinality(v_ontheway),
                            'out_for_delivery_numbers', to_jsonb(v_ontheway));
end
$$;
comment on function public.admin_cancel_customer_orders(uuid) is
  'Admin only: cancel every pending/preparing/ready order of a customer (stock returned) and deactivate the account (sessions revoked). Orders already out_for_delivery are left for the admin and returned in out_for_delivery_numbers. Audited as customer_lockdown. T23 H2, F L4.';
