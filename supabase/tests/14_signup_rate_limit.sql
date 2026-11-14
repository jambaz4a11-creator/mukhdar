-- 14: حدود معدل التسجيل عبر Edge Function signup (ADR 0001، migration 20261117000001)
select plan(15);

-- ---------------------------------------------------------------- الصلاحيات
select ok(has_function_privilege('service_role', 'public.signup_rate_hit(text, text)', 'execute'),
  'service_role (Edge Function signup) can record an attempt');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated']) r(role)
    where has_function_privilege(r.role, 'public.signup_rate_hit(text, text)', 'execute')),
  0, 'anon/authenticated cannot call the rate limiter');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
    where has_table_privilege(r.role, 'private.signup_rate_limits', 'select')
       or has_table_privilege(r.role, 'private.signup_rate_limits', 'insert')),
  0, 'nobody but the owner touches the counters table directly');
select ok((select prosecdef from pg_proc where oid = 'public.signup_rate_hit(text, text)'::regprocedure),
  'the limiter is SECURITY DEFINER (service_role has no table privileges)');

delete from private.signup_rate_limits;

-- ---------------------------------------------------------------- الحد لكل رقم (5 بالساعة)
select tests.as_service();
select is(
  (select array_agg(public.signup_rate_hit('10.0.0.' || i, '9647700000001') order by i)
     from generate_series(1, 6) i),
  array[true, true, true, true, true, false],
  'the same phone from different IPs: 5 attempts per hour, the 6th is refused');
select is(public.signup_rate_hit('10.0.0.99', '9647700000002'), true,
  'another phone is not affected');

-- ---------------------------------------------------------------- الحد لكل IP (20 بالساعة)
select is(
  (select array_agg(public.signup_rate_hit('10.1.1.1', '96477100000' || lpad(i::text, 2, '0')) order by i)
     from generate_series(1, 21) i),
  array_fill(true, array[20]) || false,
  'the same IP with different phones: 20 attempts per hour, the 21st is refused');
select is(public.signup_rate_hit('10.1.1.1', null), false,
  'an attempt without a valid phone still counts against the IP');
select is(public.signup_rate_hit('10.1.1.2', null), true, 'another IP is not affected');

-- ---------------------------------------------------------------- التخزين والنافذة
select tests.as_postgres();
select is(
  (select count(*)::int from private.signup_rate_limits
    where key_hash !~ '^[0-9a-f]{64}$' or key_hash like '%9647%' or key_hash like '%10.%'),
  0, 'keys are stored as sha256 hex only, never the raw IP or phone');
select is(
  (select hits from private.signup_rate_limits
    where bucket = 'phone' and key_hash = encode(sha256(convert_to('9647700000001', 'UTF8')), 'hex')),
  6, 'refused attempts are counted too');

-- النافذة انتهت: العدّاد يبدأ من جديد
update private.signup_rate_limits set window_start = now() - interval '61 minutes';
select tests.as_service();
select is(public.signup_rate_hit('10.0.0.1', '9647700000001'), true,
  'after the 1-hour window the phone may try again');
select tests.as_postgres();
select is(
  (select hits from private.signup_rate_limits
    where bucket = 'phone' and key_hash = encode(sha256(convert_to('9647700000001', 'UTF8')), 'hex')),
  1, 'a new window restarts the counter at 1');

-- الصفوف الأقدم من يوم تُحذف
update private.signup_rate_limits set window_start = now() - interval '2 days'
 where bucket = 'ip' and key_hash = encode(sha256(convert_to('10.1.1.2', 'UTF8')), 'hex');
select tests.as_service();
select is(public.signup_rate_hit(' ', ''), true, 'blank keys are ignored (nothing to count)');
select tests.as_postgres();
select is(
  (select count(*)::int from private.signup_rate_limits
    where key_hash = encode(sha256(convert_to('10.1.1.2', 'UTF8')), 'hex')),
  0, 'rows older than a day are purged');

select * from finish();
