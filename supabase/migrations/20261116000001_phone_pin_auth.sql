-- الدخول برقم الهاتف + PIN من 6 أرقام، بدون أي رسالة (قرار المالك 2026-11-14، docs/ADR/0001-phone-pin-auth.md).
-- Supabase Auth: مزوّد Phone مع كلمة سر (الـ PIN)، تأكيد الهاتف معطّل، وSend SMS Hook يرفض كل إرسال.
-- لا يُرسل SMS ولا بريد أبداً، فالكلفة صفر حتى لو ضُبط مزوّد SMS بالخطأ (الـ hook يسبق المزوّد).

-- ---------------------------------------------------------------------
-- 1) Send SMS Hook: يرفض كل إرسال (OTP، إعادة الإرسال، تغيير الهاتف، reauthenticate)
-- ---------------------------------------------------------------------
-- يُفعَّل من اللوحة: Authentication ← Hooks ← Send SMS ← Postgres ← private.hook_send_sms_reject
-- (محلياً و CI: [auth.hook.send_sms] بـ supabase/config.toml). رفض الإرسال يُفشل معاملة GoTrue كاملة،
-- فـ signInWithOtp لا ينشئ حساباً لرقم غيره.
create or replace function private.hook_send_sms_reject(event jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'SMS is disabled: sign in with your phone number and PIN'))
$$;
comment on function private.hook_send_sms_reject(jsonb) is
  'Supabase Auth Send SMS hook: rejects every SMS (phone + PIN sign-in, no messages). ADR 0001.';

revoke all on function private.hook_send_sms_reject(jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.hook_send_sms_reject(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------
-- 2) كل حساب برقم موبايل عراقي صالح (يُخزَّن بدون "+": 9647XXXXXXXXX)
-- ---------------------------------------------------------------------
-- الضمان أن profiles.phone موجود دائماً (tg_handle_new_user ينسخه)، فلا يمنع PHONE_REQUIRED زبوناً حقيقياً.
-- حساب بلا هاتف (بريد فقط من اللوحة مثلاً) يُرفض. التحديث يُفحص فقط عند تغيّر الرقم
-- (GoTrue يكتب كل الأعمدة بكل تحديث، فالشرط when ضروري).
create or replace function private.tg_require_valid_phone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.phone is null or new.phone !~ '^9647[0-9]{9}$' then
    raise exception 'PHONE_INVALID' using errcode = 'P0001',
      detail = 'every account needs an Iraqi mobile number stored as 9647XXXXXXXXX';
  end if;
  return new;
end $$;
revoke all on function private.tg_require_valid_phone() from public, anon, authenticated, service_role;

create trigger require_valid_phone_on_insert before insert on auth.users
  for each row execute function private.tg_require_valid_phone();
create trigger require_valid_phone_on_update before update of phone on auth.users
  for each row when (old.phone is distinct from new.phone)
  execute function private.tg_require_valid_phone();

-- ---------------------------------------------------------------------
-- 3) رقم واحد = حساب واحد
-- ---------------------------------------------------------------------
-- auth.users.phone فريد أصلاً (GoTrue)؛ هذا ضمان صريح بجدولنا وصيغة ثابتة.
alter table public.profiles
  add constraint profiles_phone_format check (phone is null or phone ~ '^9647[0-9]{9}$');
create unique index profiles_phone_key on public.profiles (phone) where phone is not null;
