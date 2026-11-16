-- 07: التقييم بعد التسليم، ورموز الإشعارات
select plan(28);

select tests.remember('cust', tests.new_user('customer'));
select tests.remember('cust2', tests.new_user('customer'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('driver', tests.new_user('driver'));
select tests.remember('o_del', tests.order_in('delivered', tests.id('cust'), tests.id('driver')));
select tests.remember('o_pend', tests.order_in('pending', tests.id('cust')));
select tests.remember('o_del2', tests.order_in('delivered', tests.id('cust2')));

-- ---------------------------------------------------------------- rate_order
select tests.as_user(tests.id('cust'));
select lives_ok(format($$ select public.rate_order(%L, 5, '  ممتاز  ') $$, tests.id('o_del')), 'customer rates a delivered order');
select throws_ok(format($$ select public.rate_order(%L, 4) $$, tests.id('o_del')), 'ALREADY_RATED', 'second rating is rejected');
select throws_ok(format($$ select public.rate_order(%L, 4) $$, tests.id('o_pend')), 'ORDER_NOT_RATEABLE', 'undelivered order cannot be rated');
select throws_ok(format($$ select public.rate_order(%L, 4) $$, tests.id('o_del2')), 'ORDER_NOT_RATEABLE', 'someone else''s order cannot be rated');
select throws_ok(format($$ select public.rate_order(%L, 0) $$, tests.id('o_del')), 'INVALID_STARS', '0 stars rejected');
select throws_ok(format($$ select public.rate_order(%L, 6) $$, tests.id('o_del')), 'INVALID_STARS', '6 stars rejected');
select throws_ok(format($$ select public.rate_order(%L, null) $$, tests.id('o_del')), 'INVALID_STARS', 'null stars rejected');
select row_eq(format($$ select stars, comment, customer_id from public.ratings where order_id = %L $$, tests.id('o_del')),
  row(5::smallint, 'ممتاز'::text, tests.id('cust')), 'customer reads own rating (comment trimmed)');
select throws_ok(format($$ insert into public.ratings (order_id, customer_id, stars) values (%L, %L, 1) $$,
  tests.id('o_pend'), tests.id('cust')), '42501', null, 'direct insert into ratings is denied');

select tests.as_user(tests.id('cust2'));
select is_empty(format($$ select 1 from public.ratings where order_id = %L $$, tests.id('o_del')),
  'another customer cannot read the rating');
select throws_ok(format($$ select public.rate_order(%L, 3, %L) $$, tests.id('o_del2'), repeat('x', 501)),
  'COMMENT_TOO_LONG', 'comment over 500 chars is rejected');

select tests.as_user(tests.id('staff'));
select isnt_empty(format($$ select 1 from public.ratings where order_id = %L $$, tests.id('o_del')), 'staff reads ratings');
select tests.as_user(tests.id('driver'));
select is_empty(format($$ select 1 from public.ratings where order_id = %L $$, tests.id('o_del')),
  'driver cannot read ratings');

-- ---------------------------------------------------------------- push tokens
select tests.as_user(tests.id('cust'));
select lives_ok($$ select public.register_push_token('ExponentPushToken[test-1]', 'ios') $$, 'customer registers a token');
select results_eq($$ select token from public.push_tokens $$, array['ExponentPushToken[test-1]'], 'customer sees own token');
select throws_ok(format($$ insert into public.push_tokens (user_id, token, platform) values (%L, 't2', 'ios') $$,
  tests.id('cust2')), '42501', null, 'cannot insert a token for another user');

select tests.as_user(tests.id('cust2'));
select lives_ok($$ select public.register_push_token('ExponentPushToken[test-1]', 'android') $$,
  'same device signs in to another account');
select results_eq($$ select token, platform::text from public.push_tokens $$,
  $$ values ('ExponentPushToken[test-1]', 'android') $$, 'token moved to the new account');
select tests.as_user(tests.id('cust'));
select is_empty($$ select 1 from public.push_tokens $$, 'previous account no longer has the token');
select throws_ok(format($$ insert into public.push_tokens (user_id, token, platform) values (%L, 't-own', 'ios') $$,
  tests.id('cust')), '42501', null, 'direct insert of an own token is denied (register_push_token only, S3)');
select lives_ok($$ select public.register_push_token('ExponentPushToken[own-2]', 'ios') $$, 'register_push_token still works');
select throws_ok($$ update public.push_tokens set token = 'not-an-expo-token' $$, '42501', null,
  'direct update of an own token is denied (no bypass of the format check)');
select lives_ok($$ delete from public.push_tokens where token = 'ExponentPushToken[own-2]' $$,
  'own token can still be deleted (sign-out)');
select throws_ok($$ select public.register_push_token('', 'ios') $$, 'INVALID_TOKEN', 'empty token is rejected');
select throws_ok($$ select public.register_push_token('   ', 'ios') $$, 'INVALID_TOKEN', 'blank token is rejected');
select throws_ok(format($$ select public.register_push_token(%L, 'ios') $$, repeat('t', 256)),
  'INVALID_TOKEN', 'token longer than 255 characters is rejected');
select throws_ok($$ select public.register_push_token('ExponentPushToken[x]', null) $$, 'INVALID_TOKEN',
  'missing platform is rejected');

select tests.as_anon();
select throws_ok($$ select public.register_push_token('t3', 'ios') $$, '42501', null, 'anon cannot register tokens');

select * from finish();
