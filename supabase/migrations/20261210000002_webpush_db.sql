-- T36 (W3) migration B: اشتراكات Web Push داخل push_tokens (SPEC-webpush §5.3).
--   * push_tokens.keys jsonb ({p256dh, auth} base64url بلا حشو): إلزامي لـ webpush ومحظور لغيره.
--   * حماية SSRF بالقاعدة (والمرسِل يفحص ثانية، T35): الـ endpoint https، بلا منفذ ولا بيانات دخول، المضيف من
--     القائمة البيضاء، محارف ASCII مرئية فقط، طول ≤ 1024. المنصة 'web' ⇔ المزوّد 'webpush'.
--   * register_web_push(p_endpoint, p_p256dh, p_auth): نفس قواعد register_push_token (الذي لا يُمس).
--   * claim_push_notifications: يضيف keys لمستلمي webpush فقط (مستلمو Expo بنفس الشكل حرفياً).
-- القيود مكتوبة داخل CHECK مباشرة (بلا دالة مساعدة) كي لا تعتمد على ما لا يصل إليه دور الكاتب (CLAUDE.md).

alter table public.push_tokens add column keys jsonb;
comment on column public.push_tokens.keys is
  'Web Push subscription keys {p256dh, auth} (base64url, no padding). Required for provider webpush, null otherwise.';
comment on column public.push_tokens.token is
  'Expo push token, or the Web Push endpoint (a send capability: never logged).';

-- CHECK يقبل NULL كنجاح: كل فرع يُغلَّف بـ coalesce(..., false)، وCASE المتداخل يضمن ترتيب التقييم
-- (لا يُطبَّق `keys - 'x'` على قيمة ليست كائناً).
alter table public.push_tokens add constraint push_tokens_webpush_shape check (coalesce(
  case when provider = 'webpush' then
         case when platform = 'web' and jsonb_typeof(keys) = 'object' then
                char_length(token) <= 1024
                and token ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)/[!-~]*$'
                and keys - 'p256dh' - 'auth' = '{}'::jsonb
                and coalesce(keys ->> 'p256dh', '') ~ '^B[A-Za-z0-9_-]{86}$'
                and coalesce(keys ->> 'auth', '') ~ '^[A-Za-z0-9_-]{22}$'
              else false
         end
       else keys is null and platform <> 'web'
  end, false));

-- ---------------------------------------------------------------------
-- register_web_push: نفس قواعد register_push_token (نسخة 20261202000001)
-- ---------------------------------------------------------------------
create function public.register_web_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role    public.user_role;
  v_flag    boolean;
  v_session uuid;
  -- بعض المتصفحات قد تُرجع base64url بحشو: يُزال قبل التخزين (المرسِل يتوقعه بلا حشو)
  v_p256dh  text := rtrim(btrim(p_p256dh), '=');
  v_auth    text := rtrim(btrim(p_auth), '=');
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
  if p_endpoint is null or char_length(p_endpoint) > 1024
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)/[!-~]*$'
     or v_p256dh is null or v_p256dh !~ '^B[A-Za-z0-9_-]{86}$'
     or v_auth is null or v_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'INVALID_TOKEN' using errcode = 'P0001';
  end if;

  -- نفس الـ endpoint لحساب آخر (جهاز مشترك: خروج ثم دخول بحساب آخر) ← ينتقل للحساب الحالي بمفاتيحه الجديدة
  insert into public.push_tokens (user_id, token, platform, provider, keys, session_id)
  values (auth.uid(), p_endpoint, 'web', 'webpush',
          jsonb_build_object('p256dh', v_p256dh, 'auth', v_auth), v_session)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, provider = excluded.provider,
        keys = excluded.keys, session_id = excluded.session_id, last_seen_at = now();

  -- أحدث 5 رموز فقط لكل مستخدم (كل المزوّدين معاً، كما بـ register_push_token)
  delete from public.push_tokens t
   where t.user_id = auth.uid()
     and t.id in (select id from public.push_tokens
                   where user_id = auth.uid()
                   order by last_seen_at desc, id desc
                   offset 5);
end
$$;

revoke all on function public.register_web_push(text, text, text) from public, anon;
grant execute on function public.register_web_push(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- claim_push_notifications: نسخة 20261208000001 + keys لمستلمي webpush (نفس نوع المخرجات)
-- ---------------------------------------------------------------------
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
                                                         'platform', t.platform)
                                      || case when t.provider = 'webpush'
                                              then jsonb_build_object('keys', t.keys)
                                              else '{}'::jsonb end
                                      order by t.id)
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
