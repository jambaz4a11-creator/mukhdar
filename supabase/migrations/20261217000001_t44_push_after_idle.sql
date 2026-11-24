-- T44 متابعة (قرار المالك 2026-11-24، SPEC-admin-push §9 A4 و§10 Q1): إشعارات الأدمن/الموظف تستمر بعد خروج الخمول
-- (12 ساعة) من اللوحة. جلسة اللوحة نفسها لا تتغير (12 ساعة، T23 M7)؛ فقط الإرسال لم يعد مربوطاً بها.
--   (1) claim_push_notifications: يُحذف شرط "جلسة aal2 حيّة" (private.panel_push_session_ok، T23 F H1). بدلاً منه يُفحص
--       الحساب وقت الإرسال، لكل الأدوار: صف auth.users موجود وغير محذوف (deleted_at) وغير محظور (banned_until)، والملف
--       فعّال وبلا رمز مؤقت (كما كان)، والدور ضمن جمهور الإشعار (كما كان: الموظف المُخفَّض لا يطابق 'admins').
--       الأدمن/الموظف: الاشتراك يجب أن يحمل session_id (أي سُجِّل عبر register_* بجلسة aal2؛ لا مسار آخر للكتابة).
--   (2) forget_session_push(): الخروج الصريح من اللوحة يحذف اشتراكات جلسته من الخادم (إضافة لحذف العميل بالـ endpoint).
--   (3) trigger على auth.users: الحظر (banned_until بالمستقبل) أو الحذف الناعم (deleted_at) يحذف اشتراكات الحساب فوراً.
--       الحذف النهائي يحذفها أصلاً (cascade)، وتخفيض الدور والتعطيل وإعادة ضبط الرمز/المصادقة تحذفها أصلاً (set_user_role،
--       reset_mfa_factors، H1 بـ 20261125000001).
--   (4) قرار المالك Q2: تنبيه نقص المخزون للموظف أيضاً (جمهور 'admins' بدل 'admins_only').
-- لا تغيير بالبيانات ولا بالجداول. private.panel_push_session_ok تبقى (لا تُحذف) لكنها لم تعد مستعملة.

comment on column public.push_tokens.session_id is
  'Auth session that last registered the subscription (admin/staff, aal2 only). Delivery no longer depends on it (T44 follow-up, 2026-11-24): an explicit sign-out of that session deletes it (forget_session_push).';

-- ---------------------------------------------------------------------
-- (1) claim_push_notifications: نسخة 20261210000002 بفحص الحساب بدل فحص الجلسة (نفس نوع المخرجات)
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
                       join auth.users u on u.id = t.user_id
                      where p.is_active
                        and not p.must_change_pin   -- H1: رمز مؤقت لم يُغيَّر ← لا إشعارات
                        -- T44: الحساب وقت الإرسال (لا جلسة اللوحة): غير محذوف وغير محظور
                        and u.deleted_at is null
                        and (u.banned_until is null or u.banned_until <= now())
                        -- الأدمن/الموظف: اشتراك سُجِّل بجلسة aal2 (register_*)، حتى لو انتهت تلك الجلسة بالخمول بعدها
                        and (p.role not in ('admin', 'staff') or t.session_id is not null)
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

comment on function private.panel_push_session_ok(uuid) is
  'Unused since the T44 follow-up (2026-11-24): admin/staff pushes no longer require a live panel session. Kept (no destructive change).';

-- ---------------------------------------------------------------------
-- (2) الخروج الصريح: حذف اشتراكات هذه الجلسة (أي دور؛ يعمل حتى بجلسة aal1). يرجع عدد الصفوف المحذوفة.
-- ---------------------------------------------------------------------
create function public.forget_session_push()
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_n       integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if v_session is null then
    return 0;
  end if;
  delete from public.push_tokens where user_id = auth.uid() and session_id = v_session;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function public.forget_session_push() from public, anon;
grant execute on function public.forget_session_push() to authenticated;
comment on function public.forget_session_push() is
  'Explicit sign-out (T44 follow-up): deletes the caller''s push subscriptions registered by the current session.';

-- ---------------------------------------------------------------------
-- (3) الحظر أو الحذف الناعم بـ auth ← حذف الاشتراكات فوراً
-- ---------------------------------------------------------------------
create function private.tg_auth_user_push_revoke()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.deleted_at is not null
     or (new.banned_until is not null and new.banned_until > now()) then
    delete from public.push_tokens where user_id = new.id;
  end if;
  return null;
end
$$;
revoke all on function private.tg_auth_user_push_revoke() from public, anon, authenticated, service_role;

create trigger on_auth_user_banned_or_deleted after update of banned_until, deleted_at on auth.users
  for each row
  when (old.banned_until is distinct from new.banned_until or old.deleted_at is distinct from new.deleted_at)
  execute function private.tg_auth_user_push_revoke();

-- ---------------------------------------------------------------------
-- (4) قرار المالك Q2: تنبيه نقص المخزون للموظف أيضاً ('admins_only' ← 'admins'). النص كميات فقط (الرصيد والحد)،
--     بلا مبالغ (قاعدة 21_staff_money)، و/stock مسموحة للموظف أصلاً. تبديل حرفي يفشل إن لم يجد الموضع مرة واحدة.
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('private.tg_stock_low_alert()'::regprocedure);
  v_old text := 'public._notify(''admins_only'', null, ''نقص مخزون: ''';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'T44: expected exactly one admins_only low-stock notify in tg_stock_low_alert';
  end if;
  execute replace(v_def, v_old, 'public._notify(''admins'', null, ''نقص مخزون: ''');
end $$;
