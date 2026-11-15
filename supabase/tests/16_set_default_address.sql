-- 16: set_default_address (migration 20261118000001): تعيين الافتراضي بمعاملة واحدة، لصاحب العنوان فقط.
select plan(14);

-- ---------------------------------------------------------------- الصلاحيات
select ok(has_function_privilege('authenticated', 'public.set_default_address(uuid)', 'execute'),
  'authenticated can call set_default_address');
select ok(not has_function_privilege('anon', 'public.set_default_address(uuid)', 'execute'),
  'anon cannot call set_default_address');
select ok(not (select prosecdef from pg_proc where oid = 'public.set_default_address(uuid)'::regprocedure),
  'security invoker (runs under the customer''s own RLS)');

-- ---------------------------------------------------------------- التجهيز (postgres)
select tests.remember('c1', tests.new_user('customer'));
select tests.remember('c2', tests.new_user('customer'));
select tests.remember('a1', tests.new_address(tests.id('c1')));
select tests.remember('b1', tests.new_address(tests.id('c1')));
select tests.remember('a2', tests.new_address(tests.id('c2')));
update public.addresses set is_default = true where id in (tests.id('a1'), tests.id('a2'));

-- ---------------------------------------------------------------- الزبون c1
select tests.as_user(tests.id('c1'));
select lives_ok(format($$ select public.set_default_address(%L) $$, tests.id('b1')),
  'switch the default to another own address');
select results_eq($$ select id from public.addresses where is_default $$, array[tests.id('b1')],
  'exactly one default: the new one');
select lives_ok(format($$ select public.set_default_address(%L) $$, tests.id('b1')),
  'setting the current default again is a no-op');
select results_eq($$ select id from public.addresses where is_default $$, array[tests.id('b1')],
  'still exactly one default');
select lives_ok(format($$ select public.set_default_address(%L) $$, tests.id('a1')), 'switch back');
select results_eq($$ select id from public.addresses where is_default $$, array[tests.id('a1')],
  'exactly one default after switching back');
select throws_ok(format($$ select public.set_default_address(%L) $$, tests.id('a2')),
  'P0001', 'ADDRESS_NOT_FOUND', 'cannot make another customer''s address the default');
select throws_ok(format($$ select public.set_default_address(%L) $$, gen_random_uuid()),
  'P0001', 'ADDRESS_NOT_FOUND', 'an unknown address');

-- بلا مستخدم (توكن بدون sub)
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(format($$ select public.set_default_address(%L) $$, tests.id('a1')),
  '28000', 'NOT_AUTHENTICATED', 'no user in the token');

-- ---------------------------------------------------------------- لا أثر على زبون آخر
select tests.as_postgres();
select results_eq(format($$ select is_default from public.addresses where id = %L $$, tests.id('a2')),
  array[true], 'the other customer''s default is untouched');
select is((select count(*)::int from public.addresses where customer_id = tests.id('c1') and is_default), 1,
  'c1 ends with one default');

select * from finish();
