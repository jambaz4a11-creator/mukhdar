-- طلبات تسجيل السواق (T27، SPEC-driver §3 و§4.1 D1–D13، قرار المالك 2026-11-19).
-- السائق يسجّل باسمه ورقمه من تطبيق apps/driver ← طلب معلّق **بلا أي حساب** ← الأدمن يتصل ويوافق ←
-- نفس الجهاز فقط (من يملك "سر الجهاز") يختار رمزه ← Edge Function تنشئ الحساب ← سائق فعّال.
--   D1  public.driver_requests (RLS بلا سياسات، لا صلاحيات لأي دور: الدوال فقط)
--   D2  private.driver_request_rate_limits + driver_request_rate_hit (service_role): 10/ساعة IP، 3/24 ساعة رقم
--   D3  submit_driver_request (service_role)
--   D4  driver_request_status (anon + authenticated): الجهاز بلا حساب يقرأ الحالة بسرّه
--   D5  list_driver_requests، D6 decide_driver_request (أدمن aal2، admin_audit)
--   D7  begin_driver_completion، finish_driver_registration (service_role)
--   D8  admin_audit.action يقبل 'driver_request'
--   D9  جمهور الإشعار 'driver_request' + notification_outbox.driver_request_id + claim_push_notifications
--   D10 التنظيف اليومي (purge_push_history)
--   D11 grant execute صريح لكل دالة
--   D13 available_orders + line_count (عدد البنود المختلفة)
-- السر: 32 بايت عشوائية بترميز base64url بلا حشو (43 محرفاً) يولّدها التطبيق. الخادم يخزّن
-- SHA-256 (hex) **للنص** نفسه فقط، ولا يخزّن السر ولا يسجّله. لا تعديل لـ migration قديمة.

-- ---------------------------------------------------------------------
-- D1) الجدول
-- ---------------------------------------------------------------------
create table public.driver_requests (
  id                 uuid        primary key default gen_random_uuid(),
  full_name          text        not null check (char_length(full_name) between 2 and 80),
  phone              text        not null check (phone ~ '^9647[0-9]{9}$'),
  device_secret_hash text        not null check (device_secret_hash ~ '^[0-9a-f]{64}$'),
  status             text        not null default 'pending'
                                 check (status in ('pending', 'approved', 'rejected', 'completed')),
  push_token         text        check (push_token is null or (char_length(push_token) <= 255
                                        and push_token ~ '^Expo(nent)?PushToken\[[^\]]+\]$')),
  created_at         timestamptz not null default now(),
  decided_at         timestamptz,
  decided_by         uuid        references public.profiles (id) on delete set null,
  decision_note      text        check (decision_note is null or char_length(decision_note) <= 300),
  approved_until     timestamptz,
  user_id            uuid        references public.profiles (id) on delete set null,
  completed_at       timestamptz,
  constraint driver_requests_approved_window check (status <> 'approved' or approved_until is not null),
  constraint driver_requests_decided check (status = 'pending' or decided_at is not null)
);
comment on table public.driver_requests is
  'Driver self-registration (SPEC-driver §3/§4.1 D1). No policies, no grants: functions only. '
  '"expired" is computed (approved and approved_until < now()), never stored.';
-- طلب مفتوح واحد لكل رقم
create unique index driver_requests_open_phone on public.driver_requests (phone)
  where status in ('pending', 'approved');
create index driver_requests_status_idx on public.driver_requests (status, created_at);
create index driver_requests_decided_idx on public.driver_requests (decided_at desc) where decided_at is not null;
create index driver_requests_decided_by_idx on public.driver_requests (decided_by) where decided_by is not null;
create index driver_requests_user_idx on public.driver_requests (user_id) where user_id is not null;

alter table public.driver_requests enable row level security;
revoke all on public.driver_requests from public, anon, authenticated, service_role;

-- الحالة كما يراها الجهاز والأدمن (expired محسوبة)
create function private.driver_request_effective_status(p_status text, p_approved_until timestamptz)
returns text
language sql stable set search_path = ''
as $$
  select case when p_status = 'approved' and p_approved_until <= now() then 'expired' else p_status end
$$;
revoke all on function private.driver_request_effective_status(text, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- D2) حد المعدل (نفس تصميم signup_rate_hit: مفاتيح sha256، كل محاولة تُحسب)
-- ---------------------------------------------------------------------
create table private.driver_request_rate_limits (
  bucket       text        not null check (bucket in ('ip', 'phone')),
  key_hash     text        not null,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0,
  primary key (bucket, key_hash)
);
create index driver_request_rate_limits_window_idx on private.driver_request_rate_limits (window_start);
alter table private.driver_request_rate_limits enable row level security;
revoke all on private.driver_request_rate_limits from public, anon, authenticated, service_role;
comment on table private.driver_request_rate_limits is
  'Edge Functions driver-register / driver-complete-registration: 10/hour per IP, 3/24 hours per phone (sha256 keys).';

-- p_phone null = الـ IP فقط (driver-complete-registration، ورقم غير صالح)
create function public.driver_request_rate_hit(p_ip text, p_phone text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_bucket text;
  v_key    text;
  v_window interval;
  v_limit  integer;
  v_hits   integer;
  v_ok     boolean := true;
begin
  delete from private.driver_request_rate_limits where window_start < now() - interval '1 day';

  foreach v_bucket in array array['ip', 'phone'] loop
    v_key := case v_bucket when 'ip' then nullif(btrim(p_ip), '') else nullif(btrim(p_phone), '') end;
    continue when v_key is null;
    v_window := case v_bucket when 'ip' then interval '1 hour' else interval '24 hours' end;
    v_limit  := case v_bucket when 'ip' then 10 else 3 end;

    insert into private.driver_request_rate_limits as r (bucket, key_hash, window_start, hits)
    values (v_bucket, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), now(), 1)
    on conflict (bucket, key_hash) do update
      set hits         = case when r.window_start <= now() - v_window then 1 else r.hits + 1 end,
          window_start = case when r.window_start <= now() - v_window then now() else r.window_start end
    returning hits into v_hits;

    if v_hits > v_limit then
      v_ok := false;
    end if;
  end loop;
  return v_ok;
end
$$;
comment on function public.driver_request_rate_hit(text, text) is
  'Driver registration Edge Functions only: records one attempt; false if the IP (10/h) or phone (3/24h) limit is exceeded.';

-- ---------------------------------------------------------------------
-- D3) submit_driver_request (service_role؛ driver-register بعد فحص الجسم والحد)
-- ---------------------------------------------------------------------
create function public.submit_driver_request(p_phone text, p_full_name text, p_secret_hash text, p_push_token text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name  text;
  v_token text;
  v_open  public.driver_requests;
  v_id    uuid;
begin
  if p_phone is null or p_phone !~ '^9647[0-9]{9}$' then
    raise exception 'PHONE_INVALID' using errcode = 'P0001';
  end if;
  v_name := private.clean_user_text(p_full_name, true);
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'NAME_INVALID' using errcode = 'P0001';
  end if;
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'secret';
  end if;
  -- رمز إشعار ليس بصيغة Expo: يُتجاهل (الإشعار أفضل جهد؛ الاستطلاع هو الضمان)
  v_token := case when char_length(p_push_token) <= 255 and p_push_token ~ '^Expo(nent)?PushToken\[[^\]]+\]$'
                  then p_push_token end;

  -- ضغطتان أو جهازان بنفس اللحظة لنفس الرقم: يتسلسلان
  perform pg_advisory_xact_lock(hashtextextended('driver_request:' || p_phone, 0));

  if exists (select 1 from public.profiles where phone = p_phone)
     or exists (select 1 from auth.users where phone = p_phone) then
    raise exception 'PHONE_TAKEN' using errcode = 'P0001';
  end if;

  select * into v_open from public.driver_requests
   where phone = p_phone and status in ('pending', 'approved')
     for update;
  if found then
    if v_open.status = 'approved' and v_open.approved_until <= now() then
      -- موافقة منتهية: لا تمنح شيئاً؛ تُستبدل بالطلب الجديد (الأدمن يوافق من جديد بعد مكالمة)
      delete from public.driver_requests where id = v_open.id;
    elsif v_open.device_secret_hash = p_secret_hash then
      return v_open.id;   -- إعادة إرسال آمنة من نفس الجهاز
    else
      raise exception 'REQUEST_EXISTS' using errcode = 'P0001';
    end if;
  end if;

  if (select count(*) from public.driver_requests where status = 'pending') >= 50 then
    raise exception 'TOO_MANY_PENDING' using errcode = 'P0001';
  end if;

  insert into public.driver_requests (full_name, phone, device_secret_hash, push_token)
  values (v_name, p_phone, p_secret_hash, v_token)
  returning id into v_id;

  perform public._notify('admins_only', null, 'طلب سائق جديد', 'طلب سائق جديد: ' || v_name,
                         jsonb_build_object('type', 'driver_request', 'request_id', v_id));
  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- D4) driver_request_status (anon + authenticated): الجهاز بلا حساب
-- ---------------------------------------------------------------------
-- not_found لأي عدم تطابق (معرّف، سر، طول) فلا تفرّق بين "غير موجود" و"سر خاطئ". المقارنة بين hash السر
-- المرسل والمخزّن (لا مقارنة للسر نفسه)، فلا معلومة توقيت مفيدة. السر 256 بت فلا تخمين.
create function public.driver_request_status(p_request_id uuid, p_device_secret text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_req public.driver_requests;
begin
  if p_request_id is null or p_device_secret is null or p_device_secret !~ '^[A-Za-z0-9_-]{43}$' then
    return 'not_found';
  end if;
  select * into v_req from public.driver_requests where id = p_request_id;
  if not found or v_req.device_secret_hash <> encode(sha256(convert_to(p_device_secret, 'UTF8')), 'hex') then
    return 'not_found';
  end if;
  return private.driver_request_effective_status(v_req.status, v_req.approved_until);
end
$$;

-- ---------------------------------------------------------------------
-- D5) list_driver_requests (أدمن aal2)
-- ---------------------------------------------------------------------
create function public.list_driver_requests(p_status text default 'pending', p_limit integer default 50)
returns table (id uuid, full_name text, phone text, status text, created_at timestamptz,
               decided_at timestamptz, decided_by_name text, decision_note text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending', 'decided') then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_status';
  end if;

  if p_status = 'pending' then
    return query
      select r.id, r.full_name, r.phone, r.status, r.created_at, r.decided_at, null::text, r.decision_note
        from public.driver_requests r
       where r.status = 'pending'
       order by r.created_at, r.id
       limit least(greatest(coalesce(p_limit, 50), 1), 200);
  else
    return query
      select r.id, r.full_name, r.phone,
             private.driver_request_effective_status(r.status, r.approved_until),
             r.created_at, r.decided_at, p.full_name, r.decision_note
        from public.driver_requests r
        left join public.profiles p on p.id = r.decided_by
       where r.status <> 'pending' and r.decided_at >= now() - interval '30 days'
       order by r.decided_at desc, r.id
       limit least(greatest(coalesce(p_limit, 50), 1), 200);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- D6) decide_driver_request (أدمن aal2، مُدقَّق)
-- ---------------------------------------------------------------------
create function public.decide_driver_request(p_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_req  public.driver_requests;
  v_note text;
  v_new  text;
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_id is null or p_approve is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_approve';
  end if;
  v_note := private.clean_user_text(p_note, false);
  if char_length(v_note) > 300 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_note';
  end if;

  select * into v_req from public.driver_requests where id = p_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'REQUEST_ALREADY_DECIDED' using errcode = 'P0001',
      detail = private.driver_request_effective_status(v_req.status, v_req.approved_until);
  end if;

  if p_approve then
    if exists (select 1 from public.profiles where phone = v_req.phone)
       or exists (select 1 from auth.users where phone = v_req.phone) then
      raise exception 'PHONE_TAKEN' using errcode = 'P0001';
    end if;
    v_new := 'approved';
    update public.driver_requests
       set status = 'approved', decided_at = now(), decided_by = auth.uid(), decision_note = v_note,
           approved_until = now() + interval '7 days'
     where id = p_id;
    if v_req.push_token is not null then
      insert into public.notification_outbox (audience, driver_request_id, title, body, data)
      values ('driver_request', p_id, 'وافق المحل على طلبك', 'افتح التطبيق واختار رمزك',
              jsonb_build_object('type', 'driver_request_approved', 'request_id', p_id));
    end if;
  else
    v_new := 'rejected';
    update public.driver_requests
       set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = v_note,
           push_token = null
     where id = p_id;
  end if;

  insert into public.admin_audit (actor, action, target_id, before, after)
  values (auth.uid(), 'driver_request', p_id,
          jsonb_build_object('status', v_req.status),
          jsonb_build_object('status', v_new, 'note', v_note, 'phone', v_req.phone));
  return v_new;
end
$$;

-- ---------------------------------------------------------------------
-- D7) اكتمال التسجيل (service_role؛ driver-complete-registration)
-- ---------------------------------------------------------------------
create function public.begin_driver_completion(p_request_id uuid, p_secret_hash text)
returns table (phone text, full_name text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_req public.driver_requests;
begin
  select * into v_req from public.driver_requests r where r.id = p_request_id for update;
  if not found or p_secret_hash is null or v_req.device_secret_hash <> p_secret_hash then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_req.status <> 'approved' then
    raise exception 'REQUEST_NOT_APPROVED' using errcode = 'P0001', detail = v_req.status;
  end if;
  if v_req.approved_until <= now() then
    raise exception 'REQUEST_EXPIRED' using errcode = 'P0001';
  end if;
  return query select v_req.phone, v_req.full_name;
end
$$;

-- بعد auth.admin.createUser: الحساب الجديد (برقم الطلب نفسه) يصير سائقاً فعّالاً، والطلب مكتملاً، بمعاملة واحدة.
create function public.finish_driver_registration(p_request_id uuid, p_user_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_req   public.driver_requests;
  v_phone text;
begin
  select * into v_req from public.driver_requests where id = p_request_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_req.status <> 'approved' then
    raise exception 'REQUEST_NOT_APPROVED' using errcode = 'P0001', detail = v_req.status;
  end if;

  select p.phone into v_phone from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_phone is distinct from v_req.phone then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001', detail = 'p_user_id';
  end if;

  update public.profiles
     set role = 'driver', full_name = v_req.full_name, is_active = true, must_change_pin = false
   where id = p_user_id;
  update public.driver_requests
     set status = 'completed', user_id = p_user_id, completed_at = now(), push_token = null
   where id = p_request_id;
end
$$;

-- ---------------------------------------------------------------------
-- D8) التدقيق
-- ---------------------------------------------------------------------
alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check
  check (action in ('user_role', 'settings', 'order_driver', 'notifications_dismissed', 'address', 'mfa_reset',
                    'customer_lockdown', 'category', 'driver_request'));

-- ---------------------------------------------------------------------
-- D9) إشعار جهاز بلا حساب
-- ---------------------------------------------------------------------
alter table public.notification_outbox
  add column driver_request_id uuid references public.driver_requests (id) on delete cascade;
create index notification_outbox_driver_request_idx on public.notification_outbox (driver_request_id)
  where driver_request_id is not null;
alter table public.notification_outbox drop constraint notification_outbox_audience_check;
alter table public.notification_outbox add constraint notification_outbox_audience_check
  check (audience in ('user', 'drivers', 'admins', 'admins_only', 'driver_request'));
alter table public.notification_outbox add constraint notification_outbox_driver_request_target
  check ((audience = 'driver_request') = (driver_request_id is not null));

-- نسخة 20261202000001 + جمهور driver_request: رمز الطلب نفسه، فقط إن كان ما زال approved وغير منتهٍ.
-- نفس أعمدة المخرجات (push-dispatch بلا تغيير)؛ platform غير معروف لرمز الطلب ('unknown'، لا يُستعمل بالإرسال).
create or replace function public.claim_push_notifications(p_limit integer default 200)
returns table(id bigint, title text, body text, data jsonb, attempts integer, recipients jsonb)
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
    returning o.id, o.audience, o.user_id, o.driver_request_id, o.title, o.body, o.data, o.attempts
  )
  select c.id, c.title, c.body, c.data, c.attempts,
         coalesce(case when c.audience = 'driver_request' then
                    (select jsonb_agg(jsonb_build_object('token', r.push_token, 'provider', 'expo',
                                                         'platform', 'unknown'))
                       from public.driver_requests r
                      where r.id = c.driver_request_id and r.status = 'approved'
                        and r.approved_until > now() and r.push_token is not null)
                  else
                    (select jsonb_agg(jsonb_build_object('token', t.token, 'provider', t.provider,
                                                         'platform', t.platform) order by t.id)
                       from public.push_tokens t
                       join public.profiles p on p.id = t.user_id
                      where p.is_active
                        and not p.must_change_pin   -- H1: رمز مؤقت لم يُغيَّر ← لا إشعارات
                        -- T23 F H1: الأدمن/الموظف بجلسة aal2 حيّة فقط
                        and (p.role not in ('admin', 'staff') or private.panel_push_session_ok(t.session_id))
                        and case c.audience
                              when 'user'        then t.user_id = c.user_id
                              when 'drivers'     then p.role = 'driver'
                              when 'admins'      then p.role in ('admin', 'staff')
                              when 'admins_only' then p.role = 'admin'
                              else false
                            end)
                  end, '[]'::jsonb)
    from claimed c
   order by c.id
$$;

-- ---------------------------------------------------------------------
-- D10) التنظيف اليومي (نسخة 20261202000001 + طلبات السواق وحد معدلها)
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
  -- T27 D10: بيانات شخصية لطلبات انتهت (مرفوض/مكتمل/موافقة منتهية) بعد 30 يوماً من آخر تغيير
  delete from public.driver_requests
   where (status = 'rejected'  and decided_at     < now() - interval '30 days')
      or (status = 'completed' and completed_at   < now() - interval '30 days')
      or (status = 'approved'  and approved_until < now() - interval '30 days');
  delete from private.driver_request_rate_limits where window_start < now() - interval '1 day';
end
$$;

-- ---------------------------------------------------------------------
-- D13) available_orders + line_count (إضافة عمود للمخرجات = drop + create؛ نفس السلوك والصلاحيات)
-- ---------------------------------------------------------------------
drop function public.available_orders(int);
create function public.available_orders(p_limit int default 20)
returns table (id uuid, order_number bigint, status public.order_status, sector text,
               subsection text, building text, item_count bigint, line_count bigint,
               total_iqd bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.current_user_role() <> 'driver', true) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return query
    select o.id, o.order_number, o.status,
           o.address_snapshot ->> 'sector', o.address_snapshot ->> 'subsection', o.address_snapshot ->> 'building',
           (select sum(i.qty) from public.order_items i where i.order_id = o.id),
           (select count(*) from public.order_items i where i.order_id = o.id),
           o.total_iqd, o.created_at
      from public.orders o
     where o.driver_id is null and o.status = 'ready'
     order by o.created_at
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end
$$;
comment on function public.available_orders(int) is
  'Driver: unassigned ready orders, oldest first (max 50). No customer name/phone/floor/apartment. '
  'item_count = Σ qty (sale units), line_count = distinct lines ("N منتجات", T27 D13).';

-- ---------------------------------------------------------------------
-- D11) الصلاحيات (الدوال الجديدة لا تُنفَّذ افتراضياً؛ كل منح صريح)
-- ---------------------------------------------------------------------
revoke all on function public.driver_request_rate_hit(text, text) from public, anon, authenticated;
revoke all on function public.submit_driver_request(text, text, text, text) from public, anon, authenticated;
revoke all on function public.begin_driver_completion(uuid, text) from public, anon, authenticated;
revoke all on function public.finish_driver_registration(uuid, uuid) from public, anon, authenticated;
grant execute on function public.driver_request_rate_hit(text, text),
                          public.submit_driver_request(text, text, text, text),
                          public.begin_driver_completion(uuid, text),
                          public.finish_driver_registration(uuid, uuid)
  to service_role;

revoke all on function public.driver_request_status(uuid, text) from public, service_role;
grant execute on function public.driver_request_status(uuid, text) to anon, authenticated;

revoke all on function public.list_driver_requests(text, integer) from public, anon, service_role;
revoke all on function public.decide_driver_request(uuid, boolean, text) from public, anon, service_role;
grant execute on function public.list_driver_requests(text, integer),
                          public.decide_driver_request(uuid, boolean, text)
  to authenticated;

revoke all on function public.available_orders(int) from public, anon, service_role;
grant execute on function public.available_orders(int) to authenticated;
