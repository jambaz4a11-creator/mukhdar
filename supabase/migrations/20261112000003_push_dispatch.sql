-- =====================================================================
-- T07: إرسال notification_outbox عبر Edge Function `push-dispatch`
--   * مزوّد لكل رمز (push_tokens.provider): 'expo' الآن، 'fcm' محجوز (يُتخطى حتى يُنفَّذ).
--   * حجز الصفوف بـ lease: claimed_at + for update skip locked (عاملان لا يأخذان نفس الصف).
--   * التشغيل: trigger بعد كل insert بالصندوق (pg_net) + pg_cron كل دقيقة للمتبقي.
--   * المصادقة بين القاعدة والدالة: سر مشترك يُولَّد داخل القاعدة بـ Vault (لا يمر بأي شخص ولا بالـ git).
--   * رابط الدالة يُضبط لكل بيئة بـ Vault (`push_dispatch_url`)؛ بدونه (محلياً/CI) لا طلبات HTTP.
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------
-- 1) المزوّد لكل رمز، وحقل الحجز بالصندوق
-- ---------------------------------------------------------------------
create type public.push_provider as enum ('expo', 'fcm');
alter table public.push_tokens add column provider public.push_provider not null default 'expo';
alter table public.notification_outbox add column claimed_at timestamptz;

drop index if exists public.outbox_pending_idx;
create index outbox_pending_idx on public.notification_outbox (created_at, id)
  where sent_at is null and attempts < 5;

-- ---------------------------------------------------------------------
-- 2) register_push_token(p_token, p_platform, p_provider = 'expo')
--    رمز Expo يجب أن يكون بصيغة ExponentPushToken[...] / ExpoPushToken[...].
-- ---------------------------------------------------------------------
drop function public.register_push_token(text, public.push_platform);
create function public.register_push_token(
  p_token    text,
  p_platform public.push_platform,
  p_provider public.push_provider default 'expo'
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_platform is null or p_provider is null
     or nullif(btrim(p_token), '') is null or char_length(p_token) > 255
     or (p_provider = 'expo' and p_token !~ '^Expo(nent)?PushToken\[[^\]]+\]$') then
    raise exception 'INVALID_TOKEN' using errcode = 'P0001';
  end if;
  insert into public.push_tokens (user_id, token, platform, provider)
  values (auth.uid(), p_token, p_platform, p_provider)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, provider = excluded.provider,
        last_seen_at = now();
end
$$;
revoke all on function public.register_push_token(text, public.push_platform, public.push_provider) from public, anon;
grant execute on function public.register_push_token(text, public.push_platform, public.push_provider) to authenticated;

-- ---------------------------------------------------------------------
-- 3) claim_push_notifications: يحجز حتى p_limit صفاً غير مرسل، ويرجع المستلمين لكل صف.
--    security invoker: يعمل بصلاحيات service_role (C1) فقط، بدون security definer.
--    الجمهور: user ← رموز المستخدم (إن كان نشطاً)؛ drivers ← كل سائق نشط؛ admins ← الأدمن والموظفون النشطون.
--    الحجز 5 دقائق: إن تعطلت الدالة بعد الحجز، يعود الصف متاحاً بعدها.
-- ---------------------------------------------------------------------
create function public.claim_push_notifications(p_limit int default 200)
returns table (id bigint, title text, body text, data jsonb, attempts int, recipients jsonb)
language sql volatile security invoker set search_path = ''
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
                      and case c.audience
                            when 'user'    then t.user_id = c.user_id
                            when 'drivers' then p.role = 'driver'
                            when 'admins'  then p.role in ('admin', 'staff')
                            else false
                          end), '[]'::jsonb)
    from claimed c
   order by c.id
$$;

-- ---------------------------------------------------------------------
-- 4) finish_push_notifications: نتيجة كل صف + حذف الرموز الميتة (DeviceNotRegistered).
--    p_results: [{"id": 1, "ok": true, "error": null, "final": false}, ...]
--      ok    ← sent_at = now() (last_error ملاحظة اختيارية، مثل رموز fcm المتخطاة)
--      !ok   ← attempts + 1 (أو 5 مباشرة إن final)، last_error. يبقى claimed_at = now():
--               الحجز يصير مهلة انتظار (5 دقائق) قبل المحاولة التالية، فلا تُعاد فوراً بنفس التشغيل.
-- ---------------------------------------------------------------------
create function public.finish_push_notifications(p_results jsonb, p_dead_tokens text[] default '{}')
returns void
language plpgsql volatile security invoker set search_path = ''
as $$
begin
  update public.notification_outbox o set
    sent_at    = case when r.ok then now() end,
    attempts   = case when r.ok then o.attempts
                      when coalesce(r.final, false) then 5
                      else least(o.attempts + 1, 5) end,
    last_error = left(r.error, 500),
    claimed_at = case when r.ok then null else now() end
  from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as r(id bigint, ok boolean, error text, final boolean)
  where o.id = r.id and o.sent_at is null;

  delete from public.push_tokens where token = any (coalesce(p_dead_tokens, '{}'));
end
$$;

revoke all on function public.claim_push_notifications(int) from public, anon, authenticated;
revoke all on function public.finish_push_notifications(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.claim_push_notifications(int) to service_role;
grant execute on function public.finish_push_notifications(jsonb, text[]) to service_role;

-- ---------------------------------------------------------------------
-- 5) السر المشترك (يُولَّد مرة لكل بيئة داخل القاعدة) والتحقق منه للدالة
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_dispatch_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_dispatch_secret',
                                'push-dispatch: shared secret between DB triggers and the Edge Function');
  end if;
end $$;

create function public.push_dispatch_authorized(p_secret text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets
     where name = 'push_dispatch_secret' and decrypted_secret = p_secret)
$$;
revoke all on function public.push_dispatch_authorized(text) from public, anon, authenticated;
grant execute on function public.push_dispatch_authorized(text) to service_role;

-- ---------------------------------------------------------------------
-- 6) التشغيل: طلب HTTP غير متزامن (pg_net، يُرسل بعد commit فقط) للدالة
-- ---------------------------------------------------------------------
create function private.kick_push_dispatch(p_only_if_pending boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url';
  if nullif(v_url, '') is null then
    return;  -- البيئة غير مضبوطة (محلياً/CI): لا شيء
  end if;
  if p_only_if_pending and not exists (
       select 1 from public.notification_outbox o
        where o.sent_at is null and o.attempts < 5
          and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')) then
    return;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  perform net.http_post(
    url                  := v_url,
    body                 := '{}'::jsonb,
    headers              := jsonb_build_object('Content-Type', 'application/json',
                                               'x-dispatch-secret', v_secret),
    timeout_milliseconds := 10000);
end
$$;
revoke all on function private.kick_push_dispatch(boolean) from public, anon, authenticated;

create function private.tg_kick_push_dispatch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.kick_push_dispatch(false);
  return null;
end
$$;
revoke all on function private.tg_kick_push_dispatch() from public, anon, authenticated;

create trigger notification_outbox_kick after insert on public.notification_outbox
  for each statement execute function private.tg_kick_push_dispatch();

-- احتياط: كل دقيقة، فقط إن بقي شيء غير مرسل
select cron.schedule('push-dispatch', '* * * * *', 'select private.kick_push_dispatch(true)');
