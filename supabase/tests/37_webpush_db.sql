-- 37: Web Push بالقاعدة (T36، SPEC-webpush §5.3): register_web_push بالأدوار الحقيقية، قيود push_tokens
-- (SSRF، المفاتيح، المنصة)، السقف، النقل بين حسابين، RLS، register_push_token كما هو، وclaim يرجع المفاتيح.
select plan(63);

-- ثوابت الاختبار: مفاتيح بصيغة صحيحة (65 بايت تبدأ بـ 0x04 ← 'B' + 86 حرفاً؛ auth 16 بايت ← 22 حرفاً)
select set_config('t.p256', 'B' || repeat('A', 86), true);
select set_config('t.auth', repeat('a', 22), true);
select set_config('t.fcm',  'https://fcm.googleapis.com/fcm/send/t37-' || gen_random_uuid(), true);

create function tests.t37_reg(p_endpoint text, p_p256 text default null, p_auth text default null) returns text
language sql as $$
  select tests.try(format('select public.register_web_push(%L, %L, %L)', p_endpoint,
                          coalesce(p_p256, current_setting('t.p256')), coalesce(p_auth, current_setting('t.auth'))))
$$;
grant execute on function tests.t37_reg(text, text, text) to authenticated, anon;

-- ================================================================ الصلاحيات
select ok(has_function_privilege('authenticated', 'public.register_web_push(text, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.register_web_push(text, text, text)', 'execute'),
  'register_web_push: authenticated only (not anon, not PUBLIC)');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
            where oid = 'public.register_web_push(text, text, text)'::regprocedure),
  'register_web_push is SECURITY DEFINER with a fixed search_path');
select ok(not has_table_privilege('authenticated', 'public.push_tokens', 'insert')
      and not has_table_privilege('authenticated', 'public.push_tokens', 'update'),
  'apps still cannot insert/update push_tokens directly (only through the functions)');

-- ================================================================ التجهيز (postgres)
select tests.remember('cust',  tests.new_user('customer'));
select tests.remember('cust2', tests.new_user('customer'));
select tests.remember('drv',   tests.new_user('driver'));
select tests.remember('pin',   tests.new_user('customer'));
select tests.remember('staff', tests.new_user('staff'));
update public.profiles set must_change_pin = true where id = tests.id('pin');

-- ================================================================ الزبون والسائق بدورهما الحقيقي (aal1 مثل التطبيق)
select tests.as_user_aal1(tests.id('cust'));
select is(tests.t37_reg(current_setting('t.fcm')), 'OK', 'customer (aal1): registers a Web Push subscription');
select results_eq(
  format($$ select provider::text, platform::text, keys, session_id from public.push_tokens where token = %L $$,
         current_setting('t.fcm')),
  format($$ values ('webpush', 'web', jsonb_build_object('p256dh', %L, 'auth', %L), null::uuid) $$,
         current_setting('t.p256'), current_setting('t.auth')),
  'stored as provider webpush, platform web, with its keys; customers have no session binding');
select is(tests.t37_reg(current_setting('t.fcm'), current_setting('t.p256') || '=', current_setting('t.auth') || '=='), 'OK',
  'padded base64url keys are accepted');
select is((select keys from public.push_tokens where token = current_setting('t.fcm')),
  jsonb_build_object('p256dh', current_setting('t.p256'), 'auth', current_setting('t.auth')),
  '... and stored without padding (what the sender expects)');

select tests.as_user_aal1(tests.id('drv'));
select is(tests.t37_reg('https://web.push.apple.com/t37-drv-apple'), 'OK',
  'driver (aal1): registers an Apple Web Push subscription');
select is(tests.t37_reg('https://updates.push.services.mozilla.com/wpush/v2/t37-moz'), 'OK', 'Mozilla endpoint is accepted');
select is(tests.t37_reg('https://wns2-par02p.notify.windows.com/w/?token=t37%2Bwns'), 'OK', 'Windows (WNS) endpoint is accepted');

-- ================================================================ الرفض
select tests.as_user_aal1(tests.id('pin'));
select is(tests.t37_reg('https://fcm.googleapis.com/fcm/send/t37-pin'), 'PIN_CHANGE_REQUIRED',
  'must_change_pin account is refused');
select tests.as_anon();
select throws_ok(format($$ select public.register_web_push(%L, %L, %L) $$, 'https://fcm.googleapis.com/fcm/send/t37-anon',
                        current_setting('t.p256'), current_setting('t.auth')),
  '42501', null, 'anon cannot call register_web_push');
select tests.as_user_aal1(tests.id('staff'));
select is(tests.t37_reg('https://fcm.googleapis.com/fcm/send/t37-staff1'), 'MFA_REQUIRED',
  'staff without an active aal2 role is refused');
select tests.as_panel(tests.id('staff'));
select is(tests.t37_reg('https://fcm.googleapis.com/fcm/send/t37-staff2'), 'OK', 'staff with an aal2 panel session: accepted');
select tests.as_postgres();
select isnt((select session_id from public.push_tokens where token = 'https://fcm.googleapis.com/fcm/send/t37-staff2'), null,
  'staff subscription is bound to its session (same rule as register_push_token)');

select tests.as_user_aal1(tests.id('cust2'));
select is(tests.t37_reg(e), 'INVALID_TOKEN', 'rejected endpoint: ' || why) from (values
  ('http://fcm.googleapis.com/fcm/send/x', 'http'),
  ('https://fcm.googleapis.com:443/fcm/send/x', 'explicit port'),
  ('https://fcm.googleapis.com:8443/x', 'port'),
  ('https://user@fcm.googleapis.com/x', 'credentials'),
  ('https://fcm.googleapis.com@evil.example.com/x', 'host smuggling'),
  ('https://evil.example.com/x', 'host not allowed'),
  ('https://fcm.googleapis.com.evil.com/x', 'allowed host as a prefix'),
  ('https://push.apple.com/x', 'bare push.apple.com'),
  ('https://evilpush.apple.com/x', 'suffix without a dot'),
  ('https://169.254.169.254/latest/meta-data', 'IP literal'),
  ('https://FCM.googleapis.com/x', 'upper-case host'),
  ('https://fcm.googleapis.com', 'no path'),
  ('https://fcm.googleapis.com/a b', 'space'),
  ('https://fcm.googleapis.com/' || repeat('a', 1000), 'longer than 1024'),
  ('', 'empty')
) v(e, why);
select is(tests.try(format('select public.register_web_push(null, %L, %L)', current_setting('t.p256'), current_setting('t.auth'))),
  'INVALID_TOKEN', 'null endpoint is rejected');
select is(char_length('https://fcm.googleapis.com/' || repeat('a', 997)), 1024, '(the next endpoint is exactly 1024 characters)');
select is(tests.t37_reg('https://fcm.googleapis.com/' || repeat('a', 997)), 'OK', 'exactly 1024 characters is accepted');

select is(tests.try(format('select public.register_web_push(%L, null, %L)', 'https://fcm.googleapis.com/fcm/send/k1', current_setting('t.auth'))),
  'INVALID_TOKEN', 'missing p256dh is rejected');
select is(tests.try(format('select public.register_web_push(%L, %L, null)', 'https://fcm.googleapis.com/fcm/send/k2', current_setting('t.p256'))),
  'INVALID_TOKEN', 'missing auth is rejected');
select is(tests.t37_reg('https://fcm.googleapis.com/fcm/send/k3', 'A' || repeat('A', 86)), 'INVALID_TOKEN',
  'p256dh that is not an uncompressed P-256 key is rejected');
select is(tests.t37_reg('https://fcm.googleapis.com/fcm/send/k4', null, repeat('a', 21)), 'INVALID_TOKEN',
  'auth of the wrong length is rejected');
select is(tests.t37_reg('https://fcm.googleapis.com/fcm/send/k5', null, repeat('a', 20) || '+/'), 'INVALID_TOKEN',
  'keys outside the base64url alphabet are rejected');

-- ================================================================ السقف (5 لكل حساب، كل المزوّدين معاً)
select tests.as_postgres();
delete from public.push_tokens where user_id = tests.id('cust2');
select tests.as_user_aal1(tests.id('cust2'));
select public.register_push_token('ExponentPushToken[t37-cap-expo]', 'android');
select public.register_web_push('https://fcm.googleapis.com/fcm/send/cap-' || g, current_setting('t.p256'), current_setting('t.auth'))
  from generate_series(1, 5) g;
select is((select count(*)::int from public.push_tokens), 5, 'the 6th registration keeps only the 5 newest');
select is((select count(*)::int from public.push_tokens where token = 'ExponentPushToken[t37-cap-expo]'), 0,
  '... the oldest (here the Expo token) is the one dropped');

-- ================================================================ النقل بين حسابين (جهاز مشترك)
select tests.as_user_aal1(tests.id('cust'));
select set_config('t.shared', 'https://fcm.googleapis.com/fcm/send/t37-shared', true);
select is(tests.t37_reg(current_setting('t.shared')), 'OK', 'account A registers the device');
select tests.as_user_aal1(tests.id('cust2'));
select is(tests.t37_reg(current_setting('t.shared'), 'B' || repeat('C', 86), repeat('c', 22)), 'OK',
  'account B registers the same endpoint (after A signed out on that device)');
select tests.as_postgres();
select results_eq(format($$ select user_id, keys ->> 'p256dh' from public.push_tokens where token = %L $$, current_setting('t.shared')),
  format($$ values (%L::uuid, %L) $$, tests.id('cust2'), 'B' || repeat('C', 86)),
  'the subscription moved to B with B''s keys (one row, not two)');

-- ================================================================ RLS: المالك يقرأ ويحذف صفه فقط
select tests.as_user_aal1(tests.id('cust'));
select is((select count(*)::int from public.push_tokens where token = current_setting('t.fcm')), 1,
  'owner reads their own subscription (with keys)');
select is((select count(*)::int from public.push_tokens where token = current_setting('t.shared')), 0,
  'another user''s subscription is invisible');
select is(tests.affected(format('delete from public.push_tokens where token = %L', current_setting('t.shared'))), 0,
  'cannot delete another user''s subscription');
select is(tests.affected(format('delete from public.push_tokens where token = %L', current_setting('t.fcm'))), 1,
  'owner deletes their own subscription on sign-out');
select throws_ok(format($$ insert into public.push_tokens (user_id, token, platform, provider, keys)
                           values (%L, 'https://fcm.googleapis.com/fcm/send/direct', 'web', 'webpush', '{}') $$, tests.id('cust')),
  '42501', null, 'direct insert is denied');

-- ================================================================ register_push_token كما هو (APK والزبون الأصلي)
select is(tests.try($$ select public.register_push_token('ExponentPushToken[t37-expo]', 'ios') $$), 'OK',
  'register_push_token still accepts an Expo token');
select is(tests.try(format($$ select public.register_push_token(%L, 'android') $$, current_setting('t.fcm'))), 'INVALID_TOKEN',
  'register_push_token rejects a Web Push endpoint as an Expo token');
select throws_ok(format($$ select public.register_push_token(%L, 'web', 'webpush') $$, current_setting('t.fcm')),
  '23514', null, 'register_push_token cannot create a webpush row (no keys → check violation)');
select throws_ok($$ select public.register_push_token('ExponentPushToken[t37-web]', 'web') $$,
  '23514', null, 'platform web is reserved for webpush');

-- ================================================================ القيد على الجدول نفسه (دفاع ثانٍ، بدور postgres)
select tests.as_postgres();
select throws_ok(format($$ insert into public.push_tokens (user_id, token, platform, provider, keys) values (%L, %L, 'web', 'webpush', null) $$,
                        tests.id('cust'), 'https://fcm.googleapis.com/fcm/send/c1'),
  '23514', null, 'check: webpush without keys');
select throws_ok(format($$ insert into public.push_tokens (user_id, token, platform, provider, keys) values (%L, %L, 'web', 'webpush', %L) $$,
                        tests.id('cust'), 'https://fcm.googleapis.com/fcm/send/c2',
                        jsonb_build_object('p256dh', current_setting('t.p256'), 'auth', current_setting('t.auth'), 'x', 1)),
  '23514', null, 'check: extra key in keys');
select throws_ok(format($$ insert into public.push_tokens (user_id, token, platform, provider, keys) values (%L, %L, 'web', 'webpush', %L) $$,
                        tests.id('cust'), 'https://evil.example.com/c3',
                        jsonb_build_object('p256dh', current_setting('t.p256'), 'auth', current_setting('t.auth'))),
  '23514', null, 'check: endpoint host outside the allowlist');
select throws_ok(format($$ insert into public.push_tokens (user_id, token, platform, provider, keys) values (%L, %L, 'android', 'expo', %L) $$,
                        tests.id('cust'), 'ExponentPushToken[c4]',
                        jsonb_build_object('p256dh', current_setting('t.p256'), 'auth', current_setting('t.auth'))),
  '23514', null, 'check: keys are forbidden for expo');
select throws_ok(format($$ insert into public.push_tokens (user_id, token, platform, provider, keys) values (%L, %L, 'android', 'webpush', %L) $$,
                        tests.id('cust'), 'https://fcm.googleapis.com/fcm/send/c5',
                        jsonb_build_object('p256dh', current_setting('t.p256'), 'auth', current_setting('t.auth'))),
  '23514', null, 'check: webpush must be platform web');

-- ================================================================ claim_push_notifications
update public.notification_outbox set sent_at = now() where sent_at is null;
delete from public.push_tokens where user_id in (tests.id('cust'), tests.id('drv'), tests.id('pin'));
insert into public.push_tokens (user_id, token, platform, provider, keys) values
  (tests.id('cust'), 'ExponentPushToken[t37-claim-expo]', 'android', 'expo', null),
  (tests.id('cust'), 'https://fcm.googleapis.com/fcm/send/t37-claim', 'web', 'webpush',
   jsonb_build_object('p256dh', current_setting('t.p256'), 'auth', current_setting('t.auth'))),
  (tests.id('drv'), 'https://web.push.apple.com/t37-claim-drv', 'web', 'webpush',
   jsonb_build_object('p256dh', current_setting('t.p256'), 'auth', current_setting('t.auth'))),
  -- رمز صالح لحساب عليه must_change_pin (أُضيف قبل إعادة الضبط مثلاً): لا يستلم
  (tests.id('pin'), 'https://fcm.googleapis.com/fcm/send/t37-claim-pin', 'web', 'webpush',
   jsonb_build_object('p256dh', current_setting('t.p256'), 'auth', current_setting('t.auth')));
insert into public.notification_outbox (audience, user_id, title, body) values
  ('user', tests.id('cust'), 'T37-user', 'b'),
  ('user', tests.id('pin'),  'T37-pin', 'b');
insert into public.notification_outbox (audience, title, body, data)
  values ('drivers', 'T37-drivers', 'b', jsonb_build_object('type', 'new_order'));

create temp table t37_claimed (id bigint, title text, body text, data jsonb, attempts int, recipients jsonb);
grant all on t37_claimed to service_role;
select tests.as_service();
insert into t37_claimed select * from public.claim_push_notifications(50);
select is((select recipients from t37_claimed where title = 'T37-user'),
  jsonb_build_array(
    jsonb_build_object('token', 'ExponentPushToken[t37-claim-expo]', 'provider', 'expo', 'platform', 'android'),
    jsonb_build_object('token', 'https://fcm.googleapis.com/fcm/send/t37-claim', 'provider', 'webpush', 'platform', 'web',
                       'keys', jsonb_build_object('p256dh', current_setting('t.p256'), 'auth', current_setting('t.auth')))),
  'claim: webpush recipients carry keys; Expo recipients keep the exact old shape');
select is((select recipients from t37_claimed where title = 'T37-pin'), '[]'::jsonb,
  'claim: a must_change_pin account still gets nothing (webpush included)');
select ok((select recipients @> jsonb_build_array(jsonb_build_object('token', 'https://web.push.apple.com/t37-claim-drv',
                                                                     'provider', 'webpush', 'keys', jsonb_build_object('auth', current_setting('t.auth'))))
             from t37_claimed where title = 'T37-drivers'),
  'claim: drivers audience includes a driver''s Web Push subscription with keys');
select is((select data from t37_claimed where title = 'T37-drivers'), jsonb_build_object('type', 'new_order'),
  'claim: the payload data is unchanged (no new fields)');

-- finish حذف endpoint ميت (404/410) كأي رمز
select lives_ok($$ select public.finish_push_notifications('[]'::jsonb, array['https://fcm.googleapis.com/fcm/send/t37-claim']) $$,
  'finish: a dead endpoint is removed like any dead token');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where token = 'https://fcm.googleapis.com/fcm/send/t37-claim'), 0,
  '... the subscription row is gone');

select * from finish();
