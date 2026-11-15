-- 17: revoke_user_sessions (migration 20261119000001): إبطال كل جلسات مستخدم، لـ service_role فقط.
select plan(10);

-- ---------------------------------------------------------------- الصلاحيات
select ok(has_function_privilege('service_role', 'public.revoke_user_sessions(uuid)', 'execute'),
  'service_role can call revoke_user_sessions');
select ok(not has_function_privilege('authenticated', 'public.revoke_user_sessions(uuid)', 'execute'),
  'authenticated cannot call revoke_user_sessions');
select ok(not has_function_privilege('anon', 'public.revoke_user_sessions(uuid)', 'execute'),
  'anon cannot call revoke_user_sessions');
select is((select proconfig from pg_proc where oid = 'public.revoke_user_sessions(uuid)'::regprocedure),
  array['search_path=""'], 'fixed empty search_path (security definer)');

-- ---------------------------------------------------------------- التجهيز (postgres)
select tests.remember('u1', tests.new_user('customer'));
select tests.remember('u2', tests.new_user('customer'));
select tests.remember('s1', gen_random_uuid());
select tests.remember('s2', gen_random_uuid());
select tests.remember('s3', gen_random_uuid());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  (tests.id('s1'), tests.id('u1'), now(), now()),
  (tests.id('s2'), tests.id('u1'), now(), now()),
  (tests.id('s3'), tests.id('u2'), now(), now());
insert into auth.refresh_tokens (token, user_id, revoked, session_id, created_at, updated_at) values
  ('t-u1-a', tests.id('u1')::text, false, tests.id('s1'), now(), now()),
  ('t-u1-b', tests.id('u1')::text, false, tests.id('s2'), now(), now()),
  ('t-u1-legacy', tests.id('u1')::text, false, null, now(), now()),
  ('t-u2', tests.id('u2')::text, false, tests.id('s3'), now(), now());

-- ---------------------------------------------------------------- غير المخوّل
select tests.as_user(tests.id('u2'));
select throws_ok(format($$ select public.revoke_user_sessions(%L) $$, tests.id('u1')),
  '42501', null, 'a signed-in user cannot revoke anyone''s sessions');

-- ---------------------------------------------------------------- service_role
select tests.as_service();
select is(public.revoke_user_sessions(tests.id('u1')), 2, 'returns the number of revoked sessions');
select tests.as_postgres();
select is((select count(*)::int from auth.sessions where user_id = tests.id('u1')), 0,
  'all sessions of the user are gone');
select is((select count(*)::int from auth.refresh_tokens where user_id = tests.id('u1')::text), 0,
  'all refresh tokens of the user are gone (including ones without a session)');
select is((select count(*)::int from auth.sessions where user_id = tests.id('u2')), 1,
  'other users keep their sessions');

select tests.as_service();
select is(public.revoke_user_sessions(null), 0, 'null user: nothing happens');

select * from finish();
