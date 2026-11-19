-- 36: طلبات تسجيل السواق (T27، SPEC-driver §3 و§4.1 D1–D13، migration 20261208000001).
--   كل نداء بدوره الحقيقي: الجهاز بلا حساب = anon، الأدمن aal2 (و aal1 مرفوض)، Edge Functions = service_role.
--   دور postgres للتجهيز وللتحقق من الصفوف فقط (الجدول بلا سياسات؛ لا أحد يقرأه مباشرة).
select plan(97);

-- ================================================================ التجهيز (postgres)
select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('drv',   tests.new_user('driver'));
select tests.remember('cust',  tests.new_user('customer'));

-- الأرقام من تسلسل الاختبارات (غير مستعملة بأي حساب)
select set_config('t.p1', nextval('tests.phone_seq')::text, true);
select set_config('t.p2', nextval('tests.phone_seq')::text, true);
select set_config('t.p3', nextval('tests.phone_seq')::text, true);
select set_config('t.p4', nextval('tests.phone_seq')::text, true);
select set_config('t.p5', nextval('tests.phone_seq')::text, true);
select set_config('t.cust_phone', (select phone from public.profiles where id = tests.id('cust')), true);

-- سر الجهاز: 32 بايت base64url بلا حشو = 43 محرفاً. الخادم يخزّن SHA-256 (hex) للنص نفسه.
create function tests.t36_hash(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;
select set_config('t.s1', repeat('a', 42) || 'A', true);
select set_config('t.s2', repeat('b', 42) || 'B', true);
select set_config('t.s3', repeat('c', 42) || '-', true);
select set_config('t.s4', repeat('d', 42) || '_', true);
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- الصندوق يبدأ فارغاً من منظور الاختبار (يُلغى مع المعاملة)
update public.notification_outbox set sent_at = now() where sent_at is null;

-- ================================================================ المخطط والصلاحيات
select is((select relrowsecurity from pg_class where oid = 'public.driver_requests'::regclass), true,
  'driver_requests: RLS enabled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'driver_requests'), 0,
  'driver_requests: no policies (functions only)');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p(priv)
    where has_table_privilege(r.role, 'public.driver_requests', p.priv)
       or has_table_privilege(r.role, 'private.driver_request_rate_limits', p.priv)),
  0, 'no role has any table privilege on driver_requests or the rate-limit table');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in
          ('driver_request_rate_hit', 'submit_driver_request', 'driver_request_status', 'list_driver_requests',
           'decide_driver_request', 'begin_driver_completion', 'finish_driver_registration')
      and has_function_privilege('anon', p.oid, 'execute')),
  array['driver_request_status'], 'anon executes driver_request_status only');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in
          ('driver_request_rate_hit', 'submit_driver_request', 'driver_request_status', 'list_driver_requests',
           'decide_driver_request', 'begin_driver_completion', 'finish_driver_registration')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  array['decide_driver_request', 'driver_request_status', 'list_driver_requests'],
  'authenticated executes status + the two admin functions only');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in
          ('driver_request_rate_hit', 'submit_driver_request', 'driver_request_status', 'list_driver_requests',
           'decide_driver_request', 'begin_driver_completion', 'finish_driver_registration')
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')),
  array['begin_driver_completion', 'driver_request_rate_hit', 'finish_driver_registration', 'submit_driver_request'],
  'service_role-only: rate hit, submit, begin/finish completion');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in
          ('driver_request_rate_hit', 'submit_driver_request', 'driver_request_status', 'list_driver_requests',
           'decide_driver_request', 'begin_driver_completion', 'finish_driver_registration')
      and p.prosecdef and p.proconfig = array['search_path=""']),
  7, 'all seven are SECURITY DEFINER with an empty search_path');

-- service_role فقط: كل دور آخر يُرفض بالصلاحية (42501 permission denied)
create function tests.t36_service_calls() returns setof text language sql as $$
  values ($q$ select public.driver_request_rate_hit('1.2.3.4', null) $q$),
         (format($q$ select public.submit_driver_request(%L, 'سائق', %L, null) $q$,
                 current_setting('t.p5'), tests.t36_hash('x'))),
         (format($q$ select * from public.begin_driver_completion(%L, %L) $q$, gen_random_uuid(), tests.t36_hash('x'))),
         (format($q$ select public.finish_driver_registration(%L, %L) $q$, gen_random_uuid(), gen_random_uuid()))
$$;
create function tests.t36_service_refused() returns text language sql as $$
  select string_agg(left(tests.try(c), 17), ',') from tests.t36_service_calls() c
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.as_anon();
select is(tests.t36_service_refused(), 'permission denied,permission denied,permission denied,permission denied',
  'anon cannot call the service_role functions');
select throws_ok($$ select * from public.driver_requests $$, '42501', null, 'anon cannot read driver_requests');
select tests.as_user_aal1(tests.id('cust'));
select is(tests.t36_service_refused(), 'permission denied,permission denied,permission denied,permission denied',
  'customer cannot call the service_role functions');
select throws_ok($$ select * from public.driver_requests $$, '42501', null, 'customer cannot read driver_requests');
select tests.as_user_aal1(tests.id('drv'));
select is(tests.t36_service_refused(), 'permission denied,permission denied,permission denied,permission denied',
  'driver cannot call the service_role functions');
select tests.as_user(tests.id('staff'));
select is(tests.t36_service_refused(), 'permission denied,permission denied,permission denied,permission denied',
  'staff (aal2) cannot call the service_role functions');
select tests.as_user(tests.id('admin'));
select is(tests.t36_service_refused(), 'permission denied,permission denied,permission denied,permission denied',
  'admin (aal2) cannot call the service_role functions');
select throws_ok($$ select * from public.driver_requests $$, '42501', null, 'admin cannot read driver_requests directly');

-- ================================================================ D2 حد المعدل (service_role)
select tests.as_service();
select is(
  (select array_agg(public.driver_request_rate_hit('10.36.0.' || i, current_setting('t.p5')) order by i)
     from generate_series(1, 4) i),
  array[true, true, true, false], 'phone: 3 attempts per 24 hours, the 4th is refused');
select is(
  (select array_agg(public.driver_request_rate_hit('10.36.1.1', null) order by i) from generate_series(1, 11) i),
  array[true, true, true, true, true, true, true, true, true, true, false],
  'IP: 10 attempts per hour (null phone = IP only), the 11th is refused');
select tests.as_postgres();
select is(
  (select count(*)::int from private.driver_request_rate_limits
    where key_hash in ('10.36.1.1', current_setting('t.p5'))
       or (bucket = 'ip' and key_hash = tests.t36_hash('10.36.1.1'))
       or (bucket = 'phone' and key_hash = tests.t36_hash(current_setting('t.p5')))),
  2, 'keys are stored as sha256 only (never the plain IP or phone)');
update private.driver_request_rate_limits set window_start = now() - interval '25 hours'
 where bucket = 'phone' and key_hash = tests.t36_hash(current_setting('t.p5'));
update private.driver_request_rate_limits set window_start = now() - interval '61 minutes'
 where bucket = 'ip' and key_hash = tests.t36_hash('10.36.1.1');
select tests.as_service();
select is(public.driver_request_rate_hit('10.36.1.1', current_setting('t.p5')), true,
  'both windows reset (IP after 1 hour, phone after 24 hours)');

-- ================================================================ D3 submit_driver_request (service_role)
select tests.as_service();
select lives_ok(format($$ select set_config('t.r1', public.submit_driver_request(%L, %L, %L, %L)::text, true) $$,
                       current_setting('t.p1'), E'  أحمد‏  علي ', tests.t36_hash(current_setting('t.s1')),
                       'ExponentPushToken[t36-r1]'),
  'a new request is accepted');
select tests.as_postgres();
select row_eq(format($$ select status, full_name, phone, push_token, approved_until is null, user_id is null
                         from public.driver_requests where id = %L $$, current_setting('t.r1')),
  row('pending'::text, 'أحمد  علي'::text, current_setting('t.p1'), 'ExponentPushToken[t36-r1]'::text, true, true),
  'stored pending, name cleaned (no bidi), push token kept, no account');
select is((select count(*)::int from auth.users where phone = current_setting('t.p1')), 0,
  'no Auth account is created for a request');
select row_eq(format($$ select audience, title, body, data from public.notification_outbox
                         where data ->> 'request_id' = %L $$, current_setting('t.r1')),
  row('admins_only'::text, 'طلب سائق جديد'::text, 'طلب سائق جديد: أحمد  علي'::text,
      jsonb_build_object('type', 'driver_request', 'request_id', current_setting('t.r1'))),
  'admins get one admins_only notification');

select tests.as_service();
select is(public.submit_driver_request(current_setting('t.p1'), 'أحمد علي', tests.t36_hash(current_setting('t.s1')), null)::text,
  current_setting('t.r1'), 'resubmitting with the same secret returns the same id (safe retry)');
select tests.as_postgres();
select is((select count(*)::int from public.notification_outbox where data ->> 'request_id' = current_setting('t.r1')), 1,
  'a retry does not notify the admins again');
select tests.as_service();
select throws_ok(format($$ select public.submit_driver_request(%L, 'غيره', %L, null) $$,
                        current_setting('t.p1'), tests.t36_hash(current_setting('t.s2'))),
  'REQUEST_EXISTS', 'another device for the same phone gets REQUEST_EXISTS');
select throws_ok(format($$ select public.submit_driver_request(%L, %L, %L, null) $$,
                        current_setting('t.p2'), E' ع​ ', tests.t36_hash(current_setting('t.s2'))),
  'NAME_INVALID', 'a name shorter than 2 characters (after cleaning) is refused');
select throws_ok(format($$ select public.submit_driver_request(%L, %L, %L, null) $$,
                        current_setting('t.p2'), repeat('س', 81), tests.t36_hash(current_setting('t.s2'))),
  'NAME_INVALID', 'a name longer than 80 characters is refused');
select throws_ok(format($$ select public.submit_driver_request('07801234567', 'سائق', %L, null) $$,
                        tests.t36_hash(current_setting('t.s2'))),
  'PHONE_INVALID', 'a phone that is not 9647XXXXXXXXX is refused');
select throws_ok(format($$ select public.submit_driver_request(%L, 'سائق', 'not-a-hash', null) $$, current_setting('t.p2')),
  'INVALID_REQUEST', 'a secret hash that is not 64 hex characters is refused');
select throws_ok(format($$ select public.submit_driver_request(%L, 'سائق', %L, null) $$,
                        current_setting('t.cust_phone'), tests.t36_hash(current_setting('t.s2'))),
  'PHONE_TAKEN', 'a phone that already has an account gets PHONE_TAKEN');
select lives_ok(format($$ select set_config('t.r2', public.submit_driver_request(%L, 'سائق ثاني', %L, 'garbage')::text, true) $$,
                       current_setting('t.p2'), tests.t36_hash(current_setting('t.s2'))),
  'a second request is accepted');
select tests.as_postgres();
select is((select push_token from public.driver_requests where id = current_setting('t.r2')::uuid), null,
  'a push token that is not an Expo token is ignored (stored null)');
-- كل now() بالمعاملة نفسها: نفرّق الأوقات للترتيب
update public.driver_requests set created_at = now() - interval '2 minutes' where id = current_setting('t.r1')::uuid;

-- السقف العام: 50 طلباً معلّقاً
insert into public.driver_requests (full_name, phone, device_secret_hash)
select 'حشو ' || g, (9647000000000 + g)::text, tests.t36_hash('filler' || g)
  from generate_series(1, 50 - (select count(*)::int from public.driver_requests where status = 'pending')) g;
select tests.as_service();
select throws_ok(format($$ select public.submit_driver_request(%L, 'سائق', %L, null) $$,
                        current_setting('t.p3'), tests.t36_hash(current_setting('t.s3'))),
  'TOO_MANY_PENDING', '50 pending requests: a new one gets TOO_MANY_PENDING');
select is(public.submit_driver_request(current_setting('t.p1'), 'أحمد علي', tests.t36_hash(current_setting('t.s1')), null)::text,
  current_setting('t.r1'), 'the same-secret retry still works at the cap');
select tests.as_postgres();
delete from public.driver_requests where full_name like 'حشو %';
select tests.as_service();
select lives_ok(format($$ select set_config('t.r3', public.submit_driver_request(%L, 'سائق ثالث', %L, null)::text, true) $$,
                       current_setting('t.p3'), tests.t36_hash(current_setting('t.s3'))),
  'below the cap a new request is accepted again');

-- ================================================================ D4 driver_request_status (anon)
select tests.as_anon();
select is(public.driver_request_status(current_setting('t.r1')::uuid, current_setting('t.s1')), 'pending',
  'anon: the right secret reads pending');
select is(public.driver_request_status(current_setting('t.r1')::uuid, current_setting('t.s2')), 'not_found',
  'anon: a wrong secret (right length) is not_found');
select is(public.driver_request_status(current_setting('t.r1')::uuid, left(current_setting('t.s1'), 42)), 'not_found',
  'anon: a secret of the wrong length is not_found');
select is(public.driver_request_status(current_setting('t.r1')::uuid, tests.t36_hash(current_setting('t.s1'))), 'not_found',
  'anon: sending the stored hash instead of the secret is not_found');
select is(public.driver_request_status(gen_random_uuid(), current_setting('t.s1')), 'not_found',
  'anon: an unknown id is not_found');
select is(public.driver_request_status(null, null), 'not_found', 'anon: null arguments are not_found');
select tests.as_user_aal1(tests.id('drv'));
select is(public.driver_request_status(current_setting('t.r1')::uuid, current_setting('t.s1')), 'pending',
  'authenticated may read the status too');

-- ================================================================ D5 list_driver_requests (أدمن aal2)
select tests.as_user(tests.id('admin'));
select row_eq(format($$ select full_name, phone, status, decided_at, decided_by_name, decision_note
                         from public.list_driver_requests('pending') where id = %L $$, current_setting('t.r1')),
  row('أحمد  علي'::text, current_setting('t.p1'), 'pending'::text, null::timestamptz, null::text, null::text),
  'admin lists pending requests');
select is((select array_agg(id::text order by created_at) from public.list_driver_requests('pending', 50)
            where id in (current_setting('t.r1')::uuid, current_setting('t.r2')::uuid)),
  array[current_setting('t.r1'), current_setting('t.r2')], 'pending: oldest first');
select throws_ok($$ select * from public.list_driver_requests('all') $$, 'INVALID_REQUEST',
  'an unknown filter is refused');

select tests.as_postgres();
create function tests.t36_admin_calls() returns setof text language sql as $$
  values ($q$ select * from public.list_driver_requests() $q$),
         (format($q$ select public.decide_driver_request(%L, true) $q$, current_setting('t.r1')))
$$;
create function tests.t36_admin_refused() returns text language sql as $$
  select string_agg(tests.try(c), ',') from tests.t36_admin_calls() c
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.as_user_aal1(tests.id('admin'));
select is(tests.t36_admin_refused(), 'NOT_ALLOWED,NOT_ALLOWED', 'admin with aal1 (PIN only) is refused');
select tests.as_user(tests.id('staff'));
select is(tests.t36_admin_refused(), 'NOT_ALLOWED,NOT_ALLOWED', 'staff is refused');
select tests.as_user_aal1(tests.id('drv'));
select is(tests.t36_admin_refused(), 'NOT_ALLOWED,NOT_ALLOWED', 'driver is refused');
select tests.as_user_aal1(tests.id('cust'));
select is(tests.t36_admin_refused(), 'NOT_ALLOWED,NOT_ALLOWED', 'customer is refused');
select tests.as_anon();
select is((select string_agg(left(tests.try(c), 17), ',') from tests.t36_admin_calls() c),
  'permission denied,permission denied', 'anon has no execute on the admin functions');
select tests.as_postgres();
select is((select status from public.driver_requests where id = current_setting('t.r1')::uuid), 'pending',
  'refused calls changed nothing');

-- ================================================================ D6 decide_driver_request (أدمن aal2)
select tests.as_user(tests.id('admin'));
select is(public.decide_driver_request(current_setting('t.r1')::uuid, true), 'approved', 'admin approves');
select tests.as_postgres();
select row_eq(format($$ select status, decided_by, approved_until between now() + interval '7 days' - interval '1 minute'
                                                          and now() + interval '7 days'
                         from public.driver_requests where id = %L $$, current_setting('t.r1')),
  row('approved'::text, tests.id('admin'), true), 'approved for 7 days, decided_by = the admin');
update public.driver_requests set decided_at = now() - interval '1 minute' where id = current_setting('t.r1')::uuid;
select row_eq(format($$ select actor, before, after from public.admin_audit
                         where action = 'driver_request' and target_id = %L $$, current_setting('t.r1')),
  row(tests.id('admin'), '{"status": "pending"}'::jsonb,
      jsonb_build_object('status', 'approved', 'note', null, 'phone', current_setting('t.p1'))),
  'the decision is written to admin_audit');
select row_eq(format($$ select title, data from public.notification_outbox
                         where audience = 'driver_request' and driver_request_id = %L $$, current_setting('t.r1')),
  row('وافق المحل على طلبك'::text,
      jsonb_build_object('type', 'driver_request_approved', 'request_id', current_setting('t.r1'))),
  'the device gets a driver_request notification (it has a push token)');

select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.decide_driver_request(%L, false) $$, current_setting('t.r1')),
  'REQUEST_ALREADY_DECIDED', 'a decided request cannot be decided again');
select throws_ok(format($$ select public.decide_driver_request(%L, true) $$, gen_random_uuid()),
  'REQUEST_NOT_FOUND', 'an unknown id is REQUEST_NOT_FOUND');
select throws_ok(format($$ select public.decide_driver_request(%L, false, %L) $$, current_setting('t.r2'), repeat('x', 301)),
  'INVALID_REQUEST', 'a note longer than 300 characters is refused');
select is(public.decide_driver_request(current_setting('t.r2')::uuid, false, E'  ما رد‮ على المكالمة '), 'rejected',
  'admin rejects with a note');
select tests.as_postgres();
select row_eq(format($$ select status, decision_note, push_token, approved_until from public.driver_requests where id = %L $$,
                     current_setting('t.r2')),
  row('rejected'::text, 'ما رد على المكالمة'::text, null::text, null::timestamptz),
  'rejected: note cleaned, push token cleared, no approval window');
select is((select count(*)::int from public.notification_outbox where driver_request_id = current_setting('t.r2')::uuid), 0,
  'a rejection sends no push');

-- الرقم صار له حساب بعد الطلب ← PHONE_TAKEN ويبقى معلّقاً
insert into auth.users (id, phone, aud, role) values (gen_random_uuid(), current_setting('t.p3'), 'authenticated', 'authenticated');
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.decide_driver_request(%L, true) $$, current_setting('t.r3')),
  'PHONE_TAKEN', 'approving a phone that now has an account is PHONE_TAKEN');
select tests.as_postgres();
select is((select status from public.driver_requests where id = current_setting('t.r3')::uuid), 'pending',
  'that request stays pending (the admin rejects it or upgrades the account)');

select tests.as_user(tests.id('admin'));
select is((select array_agg(status order by decided_at desc) from public.list_driver_requests('decided')
            where id in (current_setting('t.r1')::uuid, current_setting('t.r2')::uuid)),
  array['rejected', 'approved'], 'decided: newest first, with their status');
select is((select decided_by_name from public.list_driver_requests('decided') where id = current_setting('t.r1')::uuid),
  'test admin', 'decided: the deciding admin''s name');

select tests.as_anon();
select is(public.driver_request_status(current_setting('t.r1')::uuid, current_setting('t.s1')), 'approved',
  'anon: approved');
select is(public.driver_request_status(current_setting('t.r2')::uuid, current_setting('t.s2')), 'rejected',
  'anon: rejected');

-- ================================================================ D9 claim_push_notifications
select tests.as_service();
select is(
  (select recipients from public.claim_push_notifications(50) where data ->> 'request_id' = current_setting('t.r1')
      and data ->> 'type' = 'driver_request_approved'),
  jsonb_build_array(jsonb_build_object('token', 'ExponentPushToken[t36-r1]', 'provider', 'expo', 'platform', 'unknown')),
  'an approved request resolves to its own device token');
select is(pg_get_function_result('public.claim_push_notifications(integer)'::regprocedure),
  'TABLE(id bigint, title text, body text, data jsonb, attempts integer, recipients jsonb)',
  'claim_push_notifications keeps the shape push-dispatch reads');
select tests.as_postgres();
select throws_ok($$ insert into public.notification_outbox (audience, title, body) values ('driver_request', 'x', 'y') $$,
  '23514', null, 'audience driver_request requires driver_request_id');
select throws_ok(format($$ insert into public.notification_outbox (audience, driver_request_id, title, body)
                           values ('user', %L, 'x', 'y') $$, current_setting('t.r1')),
  '23514', null, 'driver_request_id only with audience driver_request');

-- ================================================================ D7 begin/finish (service_role)
select tests.as_service();
select throws_ok(format($$ select * from public.begin_driver_completion(%L, %L) $$,
                        current_setting('t.r1'), tests.t36_hash(current_setting('t.s2'))),
  'REQUEST_NOT_FOUND', 'another device''s secret is REQUEST_NOT_FOUND');
select throws_ok(format($$ select * from public.begin_driver_completion(%L, %L) $$,
                        current_setting('t.r3'), tests.t36_hash(current_setting('t.s3'))),
  'REQUEST_NOT_APPROVED', 'a pending request cannot be completed');
select throws_ok(format($$ select * from public.begin_driver_completion(%L, %L) $$,
                        current_setting('t.r2'), tests.t36_hash(current_setting('t.s2'))),
  'REQUEST_NOT_APPROVED', 'a rejected request cannot be completed');

-- المنتهية: موافقة قبل أكثر من 7 أيام
select lives_ok(format($$ select set_config('t.r4', public.submit_driver_request(%L, 'سائق رابع', %L, 'ExpoPushToken[t36-r4]')::text, true) $$,
                       current_setting('t.p4'), tests.t36_hash(current_setting('t.s4'))),
  'a fourth request');
select tests.as_user(tests.id('admin'));
select is(public.decide_driver_request(current_setting('t.r4')::uuid, true), 'approved', 'approved');
select tests.as_postgres();
update public.driver_requests set approved_until = now() - interval '1 second', decided_at = now() - interval '7 days'
 where id = current_setting('t.r4')::uuid;
select tests.as_service();
select throws_ok(format($$ select * from public.begin_driver_completion(%L, %L) $$,
                        current_setting('t.r4'), tests.t36_hash(current_setting('t.s4'))),
  'REQUEST_EXPIRED', 'an approval older than 7 days is REQUEST_EXPIRED');
select is(
  (select recipients from public.claim_push_notifications(50) where data ->> 'request_id' = current_setting('t.r4')
      and data ->> 'type' = 'driver_request_approved'),
  '[]'::jsonb, 'an expired approval resolves to no device');
select tests.as_anon();
select is(public.driver_request_status(current_setting('t.r4')::uuid, current_setting('t.s4')), 'expired',
  'anon: expired (computed, not stored)');
select tests.as_user(tests.id('admin'));
select is((select status from public.list_driver_requests('decided') where id = current_setting('t.r4')::uuid), 'expired',
  'the admin list shows expired too');

select tests.as_service();
select row_eq(format($$ select phone, full_name from public.begin_driver_completion(%L, %L) $$,
                     current_setting('t.r1'), tests.t36_hash(current_setting('t.s1'))),
  row(current_setting('t.p1'), 'أحمد  علي'::text), 'the right device gets the phone and the name');

-- الحساب كما تُنشئه driver-complete-registration (auth.admin.createUser)
select tests.as_postgres();
select tests.remember('newdrv', gen_random_uuid());
insert into auth.users (id, phone, aud, role) values (tests.id('newdrv'), current_setting('t.p1'), 'authenticated', 'authenticated');
select tests.as_service();
select throws_ok(format($$ select public.finish_driver_registration(%L, %L) $$, current_setting('t.r1'), tests.id('cust')),
  'INVALID_REQUEST', 'finishing with an account of another phone is refused');
select throws_ok(format($$ select public.finish_driver_registration(%L, %L) $$, current_setting('t.r1'), gen_random_uuid()),
  'USER_NOT_FOUND', 'finishing with an unknown account is refused');
select lives_ok(format($$ select public.finish_driver_registration(%L, %L) $$, current_setting('t.r1'), tests.id('newdrv')),
  'finish_driver_registration');
select tests.as_postgres();
select row_eq(format($$ select role::text, is_active, must_change_pin, full_name from public.profiles where id = %L $$, tests.id('newdrv')),
  row('driver'::text, true, false, 'أحمد  علي'::text), 'the account is an active driver without must_change_pin');
select row_eq(format($$ select status, user_id, completed_at is not null, push_token from public.driver_requests where id = %L $$,
                     current_setting('t.r1')),
  row('completed'::text, tests.id('newdrv'), true, null::text), 'the request is completed and its push token cleared');
select tests.as_service();
select throws_ok(format($$ select public.finish_driver_registration(%L, %L) $$, current_setting('t.r1'), tests.id('newdrv')),
  'REQUEST_NOT_APPROVED', 'finishing twice is refused (conditional transition)');
select throws_ok(format($$ select * from public.begin_driver_completion(%L, %L) $$,
                        current_setting('t.r1'), tests.t36_hash(current_setting('t.s1'))),
  'REQUEST_NOT_APPROVED', 'a completed request cannot be begun again');
select tests.as_anon();
select is(public.driver_request_status(current_setting('t.r1')::uuid, current_setting('t.s1')), 'completed',
  'anon: completed');

-- السائق الجديد بدوره الحقيقي (aal1، PIN فقط مثل التطبيق)
select tests.as_postgres();
with d as (select tests.new_user('driver') as id)
update public.orders o set driver_id = d.id from d where o.driver_id is null and o.status = 'ready';
select tests.remember('o1', tests.order_in('ready'));
select tests.as_user_aal1(tests.id('newdrv'));
select is((select count(*)::int from public.available_orders(50) where id = tests.id('o1')), 1,
  'new driver: available_orders works');
select lives_ok(format($$ select public.accept_order(%L) $$, tests.id('o1')), 'new driver: accept_order works');
select is((select driver_id from public.orders where id = tests.id('o1')), tests.id('newdrv'),
  'new driver: reads the accepted order through RLS');

-- ================================================================ إعادة التسجيل بعد الانتهاء
select tests.as_service();
select isnt(public.submit_driver_request(current_setting('t.p4'), 'سائق رابع', tests.t36_hash(current_setting('t.s1')), null)::text,
  current_setting('t.r4'), 'an expired approval does not block a new request for the same phone');
select tests.as_postgres();
select is((select count(*)::int from public.driver_requests where id = current_setting('t.r4')::uuid), 0,
  'the expired request is replaced');

-- ================================================================ D10 التنظيف اليومي
update public.driver_requests set decided_at = now() - interval '31 days' where id = current_setting('t.r2')::uuid;
update public.driver_requests set completed_at = now() - interval '31 days' where id = current_setting('t.r1')::uuid;
update public.driver_requests set created_at = now() - interval '90 days' where id = current_setting('t.r3')::uuid;
insert into public.driver_requests (full_name, phone, device_secret_hash, status, decided_at, approved_until)
values ('منتهي قديم', current_setting('t.p5'), tests.t36_hash('old'), 'approved',
        now() - interval '40 days', now() - interval '33 days'),
       ('مرفوض حديث', '9647000000001', tests.t36_hash('recent'), 'rejected', now() - interval '29 days', null);
update private.driver_request_rate_limits set window_start = now() - interval '25 hours';
select private.purge_push_history();
select is((select array_agg(full_name order by full_name) from public.driver_requests
            where id in (current_setting('t.r1')::uuid, current_setting('t.r2')::uuid, current_setting('t.r3')::uuid)
               or full_name in ('منتهي قديم', 'مرفوض حديث')),
  array['سائق ثالث', 'مرفوض حديث'],
  'purge: rejected/completed/expired older than 30 days go; pending and recent stay');
select is((select count(*)::int from private.driver_request_rate_limits), 0, 'purge: rate-limit rows older than a day go');

select * from finish();
