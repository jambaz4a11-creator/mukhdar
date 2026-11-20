-- إصلاحات مراجعة R1 لـ T27–T30 (docs/reviews/review-R1-driver.md). كل الدوال نسخ من الإصدار السابق + التعديل المذكور فقط.
--   H1  set_user_role: ترقية زبون إلى سائق تتطلب رمزاً مؤقتاً أولاً (PIN_RESET_REQUIRED) كالموظف والأدمن (قرار المالك 2026-11-20).
--       صاحب الرقم الحقيقي يستلم الرمز المؤقت بالمكالمة، ويغيّره التطبيق إجبارياً عند أول دخول.
--   M1  decide_driver_request: يقبل الرفض (سحب الموافقة) من approved، منتهية أو لا، لا من completed/rejected.
--   L1  finish_driver_registration: يتحقق من approved_until بنفسه (REQUEST_EXPIRED).
--   M4  submit_driver_request: نص إشعار الأدمن عام بلا اسم مكتوب من مجهول.
--   L5  submit_driver_request: الموافقة المنتهية تبقى مرفوضة بملاحظة بدل حذفها (يبقى السجل).
--   L8  pending_driver_requests_count() (أدمن aal2): شارة اللوحة بلا جلب أسماء وأرقام.
-- لا تعديل لـ migration قديمة.

-- ---------------------------------------------------------------------
-- H1) set_user_role: نسخة 20261202000001 + زبون ← سائق يتطلب رمزاً مؤقتاً
-- ---------------------------------------------------------------------
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
  -- R1 H1: التسجيل بلا تحقق من الهاتف، فمن يحمل رمز الحساب قد لا يملك الرقم. الرمز المؤقت (إعادة ضبط من الأدمن بعد
  -- مكالمة) يقطع الجلسات القديمة ويسلّم الرمز لصاحب الرقم الحقيقي، فيصير سائقاً.
  if (v_promote or (v_old.role = 'customer' and p_role = 'driver')) and not v_old.must_change_pin then
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
-- M1) decide_driver_request: سحب الموافقة (الرفض من approved)
-- ---------------------------------------------------------------------
create or replace function public.decide_driver_request(p_id uuid, p_approve boolean, p_note text default null)
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
  -- الموافقة من pending فقط. الرفض من pending، أو من approved (سحب الموافقة، منتهية أو سارية).
  -- مكتمل أو مرفوض: لا شيء يُسحب.
  if not (v_req.status = 'pending' or (v_req.status = 'approved' and not p_approve)) then
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
           approved_until = null, push_token = null
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
-- L1) finish_driver_registration: يتحقق من الانتهاء بنفسه
-- ---------------------------------------------------------------------
create or replace function public.finish_driver_registration(p_request_id uuid, p_user_id uuid)
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
  if v_req.approved_until <= now() then
    raise exception 'REQUEST_EXPIRED' using errcode = 'P0001';
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
-- M4 + L5) submit_driver_request: إشعار عام، والموافقة المنتهية تبقى كسجل
-- ---------------------------------------------------------------------
create or replace function public.submit_driver_request(p_phone text, p_full_name text, p_secret_hash text, p_push_token text)
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
      -- موافقة منتهية: لا تمنح شيئاً. تبقى سجلاً مرفوضاً (L5) والطلب الجديد يحتاج موافقة جديدة بعد مكالمة.
      update public.driver_requests
         set status = 'rejected', decision_note = 'انتهت مدة الموافقة وسُجّل طلب جديد',
             approved_until = null, push_token = null
       where id = v_open.id;
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

  -- M4: لا اسم ولا رقم بنص الإشعار (مدخل مجهول يصل لأجهزة الأدمن)؛ الاسم داخل اللوحة فقط
  perform public._notify('admins_only', null, 'طلب سائق جديد', 'طلب سائق جديد، افتح طلبات السواق',
                         jsonb_build_object('type', 'driver_request', 'request_id', v_id));
  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- L8) pending_driver_requests_count (أدمن aal2): شارة القائمة
-- ---------------------------------------------------------------------
create function public.pending_driver_requests_count()
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return (select count(*)::int from public.driver_requests where status = 'pending');
end
$$;
comment on function public.pending_driver_requests_count() is
  'Admin (aal2): number of pending driver requests, for the panel badge (R1 L8). No names or phones.';
revoke all on function public.pending_driver_requests_count() from public, anon, service_role;
grant execute on function public.pending_driver_requests_count() to authenticated;
