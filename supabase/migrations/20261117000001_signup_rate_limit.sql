-- التسجيل عبر الخادم (قرار المالك 2026-11-15، ADR 0001 "التحديث"): التسجيل العام بـ GoTrue يُطفأ
-- (Allow new users to sign up: OFF)، والحساب الجديد يُنشأ فقط من Edge Function `signup`
-- (auth.admin.createUser بمفتاح الخدمة). هذا الملف: حدود معدل التسجيل لكل IP ولكل رقم.
--
-- - نافذة ثابتة ساعة واحدة: 20 محاولة لكل IP (مرتفع عمداً: CGNAT يشارك IP واحداً بين زبائن كثيرين)،
--   و5 محاولات لكل رقم. كل محاولة تُحسب (حتى المرفوضة) حتى لا يُستعمل الرد لفحص الأرقام بلا حد.
-- - المفاتيح تُخزَّن مجزأة (sha256)، لا IP ولا رقم بنص صريح.
-- - الصفوف الأقدم من يوم تُحذف مع كل استدعاء (الجدول صغير).
-- - للدالة service_role فقط (Edge Function)، لا anon ولا authenticated.

create table private.signup_rate_limits (
  bucket       text        not null check (bucket in ('ip', 'phone')),
  key_hash     text        not null,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0,
  primary key (bucket, key_hash)
);
create index signup_rate_limits_window_idx on private.signup_rate_limits (window_start);
alter table private.signup_rate_limits enable row level security;
revoke all on private.signup_rate_limits from public, anon, authenticated, service_role;

comment on table private.signup_rate_limits is
  'Edge Function signup: fixed 1-hour windows per IP and per phone (sha256 keys). ADR 0001.';

-- يسجّل محاولة تسجيل ويرجع true إن كانت ضمن الحدود. p_ip و/أو p_phone قد يكونان null (رقم غير صالح:
-- يُحسب الـ IP فقط). الحدود ثابتة هنا (مصدر واحد)؛ تغييرها = migration جديدة.
create function public.signup_rate_hit(p_ip text, p_phone text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  c_window      constant interval := interval '1 hour';
  c_ip_limit    constant integer  := 20;
  c_phone_limit constant integer  := 5;
  v_bucket      text;
  v_key         text;
  v_hits        integer;
  v_ok          boolean := true;
begin
  delete from private.signup_rate_limits where window_start < now() - interval '1 day';

  foreach v_bucket in array array['ip', 'phone'] loop
    v_key := case v_bucket when 'ip' then nullif(btrim(p_ip), '') else nullif(btrim(p_phone), '') end;
    continue when v_key is null;

    insert into private.signup_rate_limits as r (bucket, key_hash, window_start, hits)
    values (v_bucket, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), now(), 1)
    on conflict (bucket, key_hash) do update
      set hits         = case when r.window_start <= now() - c_window then 1 else r.hits + 1 end,
          window_start = case when r.window_start <= now() - c_window then now() else r.window_start end
    returning hits into v_hits;

    if v_hits > (case v_bucket when 'ip' then c_ip_limit else c_phone_limit end) then
      v_ok := false;
    end if;
  end loop;

  return v_ok;
end
$$;
comment on function public.signup_rate_hit(text, text) is
  'Edge Function signup only: records one attempt; false if the IP (20/h) or phone (5/h) limit is exceeded.';

revoke all on function public.signup_rate_hit(text, text) from public, anon, authenticated;
grant execute on function public.signup_rate_hit(text, text) to service_role;
