-- 11: push-dispatch (T07): المزوّد لكل رمز، حجز الصندوق، إنهاء الإرسال، السر المشترك، والمُشغِّل
select plan(60);

-- الصندوق يبدأ فارغاً من منظور الاختبار (يُلغى مع المعاملة)
update public.notification_outbox set sent_at = now() where sent_at is null;

-- ---------------------------------------------------------------- الصلاحيات
select ok(has_function_privilege('service_role', 'public.claim_push_notifications(int)', 'execute'),
  'service_role can claim');
select ok(has_function_privilege('service_role', 'public.finish_push_notifications(jsonb, text[])', 'execute'),
  'service_role can finish');
select ok(has_function_privilege('service_role', 'public.push_dispatch_authorized(text)', 'execute'),
  'service_role can verify the dispatch secret');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated']) r(role),
          unnest(array['public.claim_push_notifications(int)', 'public.finish_push_notifications(jsonb, text[])',
                       'public.push_dispatch_authorized(text)', 'private.kick_push_dispatch(boolean)',
                       'private.push_kick_post(boolean)', 'private.purge_push_history()']) f(fn)
    where has_function_privilege(r.role, f.fn, 'execute')),
  0, 'anon/authenticated cannot execute any push-dispatch function');
-- T23 F H1: claim صارت definer (تقرأ auth.sessions لجلسة رمز الأدمن/الموظف)، والتنفيذ لـ service_role وحده
select ok((select prosecdef from pg_proc where oid = 'public.claim_push_notifications(int)'::regprocedure)
      and not has_function_privilege('authenticated', 'public.claim_push_notifications(int)', 'execute')
      and not has_function_privilege('anon', 'public.claim_push_notifications(int)', 'execute')
      and not (select prosecdef from pg_proc where oid = 'public.finish_push_notifications(jsonb, text[])'::regprocedure),
  'claim is definer but service_role-only; finish is SECURITY INVOKER');

-- ---------------------------------------------------------------- register_push_token + provider
select tests.remember('cust', tests.new_user('customer'));
select tests.as_user(tests.id('cust'));
select lives_ok($$ select public.register_push_token('ExponentPushToken[t11-a]', 'android') $$,
  'register without provider (old 2-argument call still works)');
select lives_ok($$ select public.register_push_token('fcm-device-token-t11', 'android', 'fcm') $$,
  'register an fcm token');
select results_eq($$ select token, provider::text from public.push_tokens order by id $$,
  $$ values ('ExponentPushToken[t11-a]', 'expo'), ('fcm-device-token-t11', 'fcm') $$,
  'provider defaults to expo and fcm is stored');
select throws_ok($$ select public.register_push_token('not-an-expo-token', 'android') $$, 'INVALID_TOKEN',
  'expo token must look like ExponentPushToken[...]');
select throws_ok($$ select public.register_push_token('ExpoPushToken[]', 'ios', 'expo') $$, 'INVALID_TOKEN',
  'empty expo token body is rejected');
select lives_ok($$ select public.register_push_token('ExpoPushToken[t11-b]', 'ios', 'expo') $$,
  'ExpoPushToken[...] form is accepted');
select throws_ok($$ select public.register_push_token('ExponentPushToken[x]', 'ios', null) $$, 'INVALID_TOKEN',
  'null provider is rejected');
select throws_ok($$ select public.register_push_token('fcm-device-token-t11', 'android', 'expo') $$, 'INVALID_TOKEN',
  'switching an fcm token to expo re-validates the format');
select tests.as_postgres();

-- ---------------------------------------------------------------- تجهيز الجمهور
select tests.remember('cust_off', tests.new_user('customer'));
select tests.remember('cust_none', tests.new_user('customer'));
select tests.remember('drv', tests.new_user('driver'));
select tests.remember('drv_off', tests.new_user('driver'));
select tests.remember('adm', tests.new_user('admin'));
select tests.remember('stf', tests.new_user('staff'));
update public.profiles set is_active = false where id in (tests.id('cust_off'), tests.id('drv_off'));

insert into public.push_tokens (user_id, token, platform, provider, session_id) values
  (tests.id('cust_off'), 'ExponentPushToken[t11-off]', 'ios', 'expo', null),
  (tests.id('drv'), 'ExponentPushToken[t11-drv]', 'android', 'expo', null),
  (tests.id('drv_off'), 'ExponentPushToken[t11-drv-off]', 'android', 'expo', null),
  -- T23 F H1: رمز الأدمن/الموظف مربوط بجلسة aal2
  (tests.id('adm'), 'ExponentPushToken[t11-adm]', 'ios', 'expo', tests.panel_session(tests.id('adm'))),
  (tests.id('stf'), 'ExponentPushToken[t11-stf]', 'ios', 'expo', tests.panel_session(tests.id('stf')));

insert into public.notification_outbox (audience, user_id, title, body) values
  ('user', tests.id('cust'), 'T-user', 'b'),
  ('user', tests.id('cust_off'), 'T-inactive', 'b'),
  ('user', tests.id('cust_none'), 'T-none', 'b'),
  ('drivers', null, 'T-drivers', 'b'),
  ('admins', null, 'T-admins', 'b');

create temp table claimed (id bigint, title text, body text, data jsonb, attempts int, recipients jsonb);
grant all on claimed to service_role;

-- ---------------------------------------------------------------- claim
select tests.as_service();
select lives_ok($$ insert into claimed select * from public.claim_push_notifications(10) $$,
  'service_role claims pending rows');
select is((select count(*)::int from claimed), 5, 'all 5 pending rows are claimed');
select is((select recipients from claimed where title = 'T-user'),
  jsonb_build_array(
    jsonb_build_object('token', 'ExponentPushToken[t11-a]', 'provider', 'expo', 'platform', 'android'),
    jsonb_build_object('token', 'fcm-device-token-t11', 'provider', 'fcm', 'platform', 'android'),
    jsonb_build_object('token', 'ExpoPushToken[t11-b]', 'provider', 'expo', 'platform', 'ios')),
  'user audience → all the user''s tokens, each with its provider');
select is((select recipients from claimed where title = 'T-inactive'), '[]'::jsonb,
  'inactive user gets nothing');
select is((select recipients from claimed where title = 'T-none'), '[]'::jsonb, 'user without tokens → empty');
select is((select array_agg(r ->> 'token') from claimed, jsonb_array_elements(recipients) r where title = 'T-drivers'),
  array['ExponentPushToken[t11-drv]'], 'drivers audience → active drivers only');
select is((select array_agg(r ->> 'token' order by r ->> 'token') from claimed, jsonb_array_elements(recipients) r
           where title = 'T-admins'),
  array['ExponentPushToken[t11-adm]', 'ExponentPushToken[t11-stf]'], 'admins audience → active admins and staff');
select is((select count(*)::int from public.notification_outbox
            where id in (select id from claimed) and claimed_at is not null), 5, 'claimed rows are leased');
select is((select count(*)::int from public.claim_push_notifications(10)), 0,
  'leased rows are not claimed again (a second worker gets nothing)');

-- الحد
select tests.as_postgres();
insert into public.notification_outbox (audience, user_id, title, body)
  select 'user', tests.id('cust'), 'T-batch-' || g, 'b' from generate_series(1, 3) g;
select tests.as_service();
select is((select count(*)::int from public.claim_push_notifications(2)), 2, 'p_limit is respected');
select is((select count(*)::int from public.claim_push_notifications(10)), 1, 'the rest is claimed next time');
select is((select count(*)::int from public.claim_push_notifications(0)), 0,
  'p_limit 0 is clamped to 1 (nothing left here)');

-- انتهاء الحجز (دالة تعطلت بعد الحجز)
select tests.as_postgres();
update public.notification_outbox set claimed_at = now() - interval '6 minutes' where title = 'T-none';
select tests.as_service();
select results_eq($$ select title from public.claim_push_notifications(10) $$, array['T-none'],
  'a lease older than 5 minutes is claimed again');

-- ---------------------------------------------------------------- finish
select lives_ok(format($$ select public.finish_push_notifications(%L::jsonb, array['fcm-device-token-t11']) $$,
  jsonb_build_array(
    jsonb_build_object('id', (select id from claimed where title = 'T-user'), 'ok', true,
                       'error', 'fcm: 1 token(s) skipped (provider not implemented)', 'final', false),
    jsonb_build_object('id', (select id from claimed where title = 'T-drivers'), 'ok', false,
                       'error', 'expo: HTTP 503', 'final', false),
    jsonb_build_object('id', (select id from claimed where title = 'T-admins'), 'ok', false,
                       'error', 'DeviceNotRegistered', 'final', true))),
  'service_role finishes a batch');
select tests.as_postgres();
select row_eq($$ select sent_at is not null, attempts, claimed_at is null, last_error
                   from public.notification_outbox where title = 'T-user' $$,
  row(true, 0, true, 'fcm: 1 token(s) skipped (provider not implemented)'::text),
  'ok → sent_at set, lease released, note kept in last_error');
select row_eq($$ select sent_at is null, attempts, claimed_at is not null, last_error
                   from public.notification_outbox where title = 'T-drivers' $$,
  row(true, 1, true, 'expo: HTTP 503'::text), 'retryable failure → attempts + 1, lease kept as back-off');
select row_eq($$ select sent_at is null, attempts from public.notification_outbox where title = 'T-admins' $$,
  row(true, 5), 'final failure → attempts = 5 (never retried)');
select is_empty($$ select 1 from public.push_tokens where token = 'fcm-device-token-t11' $$, 'dead token is deleted');
select isnt_empty($$ select 1 from public.push_tokens where token = 'ExponentPushToken[t11-a]' $$,
  'other tokens are kept');

update public.notification_outbox set claimed_at = now() - interval '6 minutes'
 where title in ('T-drivers', 'T-admins', 'T-user');
select tests.as_service();
select results_eq($$ select title from public.claim_push_notifications(10) $$, array['T-drivers'],
  'after back-off only the retryable row comes back (sent and final rows never do)');

select lives_ok(format($$ select public.finish_push_notifications(%L::jsonb) $$,
  jsonb_build_array(jsonb_build_object('id', (select id from claimed where title = 'T-user'), 'ok', false,
                                       'error', 'late', 'final', false))),
  'finishing an already-sent row is a no-op');
select tests.as_postgres();
select row_eq($$ select attempts, last_error from public.notification_outbox where title = 'T-user' $$,
  row(0, 'fcm: 1 token(s) skipped (provider not implemented)'::text), 'sent row is untouched');
select tests.as_service();
select lives_ok($$ select public.finish_push_notifications(null, null) $$, 'null arguments are harmless');

-- ---------------------------------------------------------------- جمهور driver_request (T27 D9)
-- جهاز بلا حساب: الرمز من driver_requests.push_token، فقط لطلب ما زال approved وغير منتهٍ
select tests.as_postgres();
insert into public.driver_requests (full_name, phone, device_secret_hash, status, decided_at, approved_until, push_token, completed_at)
values ('ط موافق', '9647000000101', repeat('a', 64), 'approved',  now(), now() + interval '7 days', 'ExponentPushToken[t11-req-ok]', null),
       ('ط مرفوض', '9647000000102', repeat('b', 64), 'rejected',  now(), null, null, null),
       ('ط مكتمل', '9647000000103', repeat('c', 64), 'completed', now(), now() + interval '7 days', 'ExponentPushToken[t11-req-done]', now());
insert into public.notification_outbox (audience, driver_request_id, title, body)
select 'driver_request', r.id, 'T-req-' || right(r.phone, 3), 'b'
  from public.driver_requests r where r.phone in ('9647000000101', '9647000000102', '9647000000103');
select tests.as_service();
insert into claimed select * from public.claim_push_notifications(50);
select is((select recipients from claimed where title = 'T-req-101'),
  jsonb_build_array(jsonb_build_object('token', 'ExponentPushToken[t11-req-ok]', 'provider', 'expo', 'platform', 'unknown')),
  'driver_request audience: an approved request resolves to its own token');
select is((select array_agg(recipients::text order by title) from claimed where title in ('T-req-102', 'T-req-103')),
  array['[]', '[]'], 'driver_request audience: rejected or completed requests resolve to nothing');

-- ---------------------------------------------------------------- السر المشترك
select tests.as_postgres();
select isnt((select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret'), null,
  'the migration generated push_dispatch_secret in Vault');
select set_config('t.secret', (select decrypted_secret from vault.decrypted_secrets
                                where name = 'push_dispatch_secret'), true);
select ok(length(current_setting('t.secret')) = 64, 'secret is 32 random bytes (hex)');
select tests.as_service();
select ok(public.push_dispatch_authorized(current_setting('t.secret')), 'correct secret is accepted');
select ok(not public.push_dispatch_authorized('wrong'), 'wrong secret is rejected');
select ok(not public.push_dispatch_authorized('') and not public.push_dispatch_authorized(null),
  'empty / null secret is rejected');
select tests.as_user(tests.id('cust'));
select throws_ok($$ select public.push_dispatch_authorized('x') $$, '42501', null,
  'an app user cannot probe the secret');
select throws_ok($$ select * from public.claim_push_notifications(1) $$, '42501', null,
  'an app user cannot claim notifications');

-- ---------------------------------------------------------------- المُشغِّل (pg_net + pg_cron)
select tests.as_postgres();
select is((select count(*)::int from cron.job where jobname = 'push-dispatch'
            and schedule = '* * * * *' and command = 'select private.kick_push_dispatch(true)'),
  1, 'pg_cron fallback runs every minute');
select is((select count(*)::int from pg_trigger where tgname = 'notification_outbox_kick'
            and tgrelid = 'public.notification_outbox'::regclass and not tgisinternal),
  1, 'outbox insert trigger exists');

-- رابط تجريبي فريد لهذه المعاملة (يُلغى مع ROLLBACK؛ لا يُرسل أي طلب لأن pg_net يرسل بعد commit فقط)
select set_config('t.url', 'http://push-dispatch.invalid/' || gen_random_uuid(), true);
do $$
declare v_id uuid := (select id from vault.secrets where name = 'push_dispatch_url');
begin
  if v_id is null then
    perform vault.create_secret(current_setting('t.url'), 'push_dispatch_url');
  else
    perform vault.update_secret(v_id, current_setting('t.url'));
  end if;
end $$;

update public.notification_outbox set sent_at = now() where sent_at is null;
-- إدخالات سابقة بهذه المعاملة ربما شغّلت الـ trigger (الرابط مضبوط على dev)؛ نبدأ بعلامة نظيفة
select set_config('mukhdar.push_kicked', '', true);
select private.kick_push_dispatch(true);
select is((select count(*)::int from net.http_request_queue where url = current_setting('t.url')), 0,
  'cron kick does nothing when nothing is pending');
insert into public.notification_outbox (audience, title, body)
  select 'drivers', 'T-kick-' || g, 'b' from generate_series(1, 3) g;
select is((select count(*)::int from net.http_request_queue where url = current_setting('t.url')), 1,
  'one insert statement (3 rows) → one HTTP kick');
select is((select headers ->> 'x-dispatch-secret' from net.http_request_queue where url = current_setting('t.url')),
  current_setting('t.secret'), 'the kick carries the shared secret header');
insert into public.notification_outbox (audience, title, body) values ('admins', 'T-kick-2nd', 'b');
select is((select count(*)::int from net.http_request_queue where url = current_setting('t.url')), 1,
  'a second insert statement in the same transaction does not kick again (one kick per transaction)');
select private.kick_push_dispatch(true);
select is((select count(*)::int from net.http_request_queue where url = current_setting('t.url')), 2,
  'cron kick fires while rows are pending');

select vault.update_secret((select id from vault.secrets where name = 'push_dispatch_url'), '');
insert into public.notification_outbox (audience, title, body) values ('drivers', 'T-kick-off', 'b');
select private.kick_push_dispatch(false);
select is((select count(*)::int from net.http_request_queue where url = '' or url = current_setting('t.url')), 2,
  'no URL configured (local/CI) → no HTTP requests');

-- ---------------------------------------------------------------- فشل التشغيل لا يُفشل المعاملة (S1)
-- نحاكي عطلاً (Vault/pg_net) باستبدال دالة الإرسال داخل المعاملة (يُلغى مع ROLLBACK)
create or replace function private.push_kick_post(p_only_if_pending boolean) returns boolean
language plpgsql as $$ begin raise exception 'simulated pg_net failure'; end $$;
select set_config('mukhdar.push_kicked', '', true);
select lives_ok($$ insert into public.notification_outbox (audience, title, body) values ('admins', 'T-kick-fail', 'b') $$,
  'outbox insert succeeds even when the kick fails');
select is((select count(*)::int from public.notification_outbox where title = 'T-kick-fail'), 1,
  'the notification row is kept for the cron retry');
select lives_ok($$ select tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.new_product(1000, 10), 1))) $$,
  'place_order succeeds even when the kick fails');
select lives_ok($$ select private.kick_push_dispatch(true) $$, 'cron kick does not raise when the kick fails');

-- ---------------------------------------------------------------- التنظيف اليومي (N3)
select is((select count(*)::int from cron.job where jobname = 'push-history-purge'
            and command = 'select private.purge_push_history()'), 1, 'daily purge job is scheduled');
insert into public.notification_outbox (audience, title, body, created_at, sent_at, attempts) values
  ('admins', 'T-purge-old-sent',    'b', now() - interval '31 days', now() - interval '31 days', 1),
  ('admins', 'T-purge-old-failed',  'b', now() - interval '31 days', null, 5),
  ('admins', 'T-purge-old-pending', 'b', now() - interval '31 days', null, 1),
  ('admins', 'T-purge-new-sent',    'b', now() - interval '29 days', now() - interval '29 days', 1);
select private.purge_push_history();
select is((select count(*)::int from public.notification_outbox where title in ('T-purge-old-sent', 'T-purge-old-failed')), 0,
  'finished notifications older than 30 days are purged');
select is((select array_agg(title order by title) from public.notification_outbox where title like 'T-purge-%'),
  array['T-purge-new-sent', 'T-purge-old-pending'], 'recent and still-retryable notifications are kept');

select * from finish();
