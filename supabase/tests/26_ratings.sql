-- 26: التقييمات (T26). rate_order المشدَّد، وratings_summary/ratings_list بأرقام يدوية على حدود يوم بغداد.
--   الأيام 2020-03-10..13 خالية. الأوقات UTC (بغداد = +3).
--   التقييمات: r1 ★5 "ممتاز" 03-10 20:59Z (23:59 بغداد 10)، r2 ★4 بلا تعليق 03-10 21:00Z (00:00 بغداد 11)،
--   r3 ★3 تعليق 03-11 06:00Z، r4 ★2 تعليق 03-11 07:00Z، r5 ★1 بلا تعليق 03-12 06:00Z،
--   r6 ★5 تعليق 03-12 06:00Z (نفس وقت r5: يختبر ترتيب keyset بالتعادل).
select plan(61);

-- ================================================================ التجهيز
select tests.remember('admin',  tests.new_user('admin'));
select tests.remember('admin2', tests.new_user('admin'));
select tests.remember('staff',  tests.new_user('staff'));
select tests.remember('staff2', tests.new_user('staff'));
select tests.remember('drv',    tests.new_user('driver'));
select tests.remember('cust',   tests.new_user('customer'));
select tests.remember('cust2',  tests.new_user('customer'));
select tests.remember('flag',   tests.new_user('customer'));
select tests.remember('off',    tests.new_user('customer'));
select tests.remember('o1', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('o2', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('o3', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('o4', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('o5', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('o6', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('o_pend', tests.order_in('pending', tests.id('cust')));
select tests.remember('o_canc', tests.order_in('cancelled', tests.id('cust')));
select tests.remember('o_other', tests.order_in('delivered', tests.id('cust2'), tests.id('drv')));
select tests.remember('o_flag', tests.order_in('delivered', tests.id('flag'), tests.id('drv')));
select tests.remember('o_off', tests.order_in('delivered', tests.id('off'), tests.id('drv')));
update public.profiles set must_change_pin = true where id = tests.id('flag');
update public.profiles set is_active = false where id = tests.id('off');

-- ================================================================ 1) rate_order: الصلاحية
select tests.as_user(tests.id('cust'));
select lives_ok(format($$ select public.rate_order(%L, 5, 'ممتاز') $$, tests.id('o1')), 'customer rates own delivered order');
select throws_ok(format($$ select public.rate_order(%L, 4) $$, tests.id('o1')), 'ALREADY_RATED', 'once per order');
select is((select stars::int from public.ratings where order_id = tests.id('o1')), 5, 'the first rating is kept after the rejected second one');
select throws_ok(format($$ select public.rate_order(%L, 4) $$, tests.id('o_pend')), 'ORDER_NOT_RATEABLE', 'pending order: not rateable');
select throws_ok(format($$ select public.rate_order(%L, 4) $$, tests.id('o_canc')), 'ORDER_NOT_RATEABLE', 'cancelled order: not rateable');
select throws_ok(format($$ select public.rate_order(%L, 4) $$, tests.id('o_other')), 'ORDER_NOT_RATEABLE', 'someone else''s order: not rateable');
select throws_ok($$ select public.rate_order(gen_random_uuid(), 4) $$, 'ORDER_NOT_RATEABLE', 'unknown order: not rateable');
select throws_ok(format($$ select public.rate_order(%L, 0) $$, tests.id('o2')), 'INVALID_STARS', '0 stars');
select throws_ok(format($$ select public.rate_order(%L, 6) $$, tests.id('o2')), 'INVALID_STARS', '6 stars');
select throws_ok(format($$ select public.rate_order(%L, null) $$, tests.id('o2')), 'INVALID_STARS', 'null stars');
select tests.as_user(tests.id('flag'));
select throws_ok(format($$ select public.rate_order(%L, 5) $$, tests.id('o_flag')), '42501', 'PIN_CHANGE_REQUIRED',
  'temporary-PIN user cannot rate even their own delivered order');
select tests.as_user(tests.id('off'));
select throws_ok(format($$ select public.rate_order(%L, 5) $$, tests.id('o_off')), '42501', 'NOT_ALLOWED',
  'deactivated user cannot rate');
select tests.as_anon();
select throws_ok(format($$ select public.rate_order(%L, 5) $$, tests.id('o1')), '42501', null, 'anon: no execute grant');
select tests.as_postgres();
select is((select count(*)::int from public.ratings where order_id in (tests.id('o_flag'), tests.id('o_off'), tests.id('o_pend'), tests.id('o_canc'), tests.id('o_other'))),
  0, 'none of the refused attempts stored a rating');

-- ================================================================ 2) التعليق: نص صرف مقصوص بحد
select tests.as_user(tests.id('cust'));
select lives_ok(format($$ select public.rate_order(%L, 4, E'  \n  زين  \t\r\n') $$, tests.id('o2')), 'whitespace around the comment');
select tests.as_postgres();
select is((select comment from public.ratings where order_id = tests.id('o2')), 'زين', 'comment is trimmed (spaces, tabs, newlines)');
select tests.as_user(tests.id('cust'));
select lives_ok(format($$ select public.rate_order(%L, 3, %L) $$, tests.id('o3'), E'سطر1\x01\x07\x1f\nسطر2'), 'control characters in the comment');
select tests.as_postgres();
select is((select comment from public.ratings where order_id = tests.id('o3')), E'سطر1\nسطر2',
  'control characters are removed, the line break is kept');
select tests.as_user(tests.id('cust'));
select lives_ok(format($$ select public.rate_order(%L, 3, %L) $$, tests.id('o4'), E'   \n\t  '), 'whitespace-only comment');
select lives_ok(format($$ select public.rate_order(%L, 2, %L) $$, tests.id('o5'), repeat('ب', 500) || repeat(' ', 40)), '500 chars plus trailing spaces');
select throws_ok(format($$ select public.rate_order(%L, 2, %L) $$, tests.id('o6'), repeat('ب', 501)), 'COMMENT_TOO_LONG', '501 chars rejected');
select tests.as_postgres();
select is((select comment from public.ratings where order_id = tests.id('o4')), null, 'whitespace-only comment is stored as null');
select is((select char_length(comment) from public.ratings where order_id = tests.id('o5')), 500, 'the limit counts the trimmed text (500)');
select is((select count(*)::int from public.ratings where order_id = tests.id('o6')), 0, 'the too-long attempt stored nothing');
select tests.as_user(tests.id('cust'));
select lives_ok(format($$ select public.rate_order(%L, 1, %L) $$, tests.id('o6'), '<script>alert(1)</script><b>x</b>'), 'markup in a comment');
select tests.as_postgres();
select is((select comment from public.ratings where order_id = tests.id('o6')), '<script>alert(1)</script><b>x</b>',
  'markup is stored as plain text, verbatim (the panel and app render text only)');

-- ================================================================ 3) لا كتابة مباشرة، والقيد
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ update public.ratings set stars = 1 where order_id = %L $$, tests.id('o1')), '42501', null, 'admin cannot edit ratings directly');
select throws_ok(format($$ delete from public.ratings where order_id = %L $$, tests.id('o1')), '42501', null, 'admin cannot delete ratings directly');
select tests.as_user(tests.id('cust'));
select throws_ok(format($$ update public.ratings set stars = 1 where order_id = %L $$, tests.id('o1')), '42501', null, 'customer cannot edit their rating');
select tests.as_postgres();
select throws_ok(format($$ insert into public.ratings (order_id, customer_id, stars, comment) values (%L, %L, 3, ' x ') $$,
  tests.id('o_pend'), tests.id('cust')), '23514', null, 'the table itself rejects an untrimmed comment');

-- ================================================================ 4) ratings_summary / ratings_list بأرقام يدوية
-- نعيد البناء: نحذف تقييمات الاختبار الحالية (بصلاحية postgres) ونُنشئ r1..r6 بالأوقات المطلوبة
delete from public.ratings;
insert into public.ratings (order_id, customer_id, stars, comment, created_at) values
  (tests.id('o1'), tests.id('cust'), 5, 'ممتاز', '2020-03-10 20:59Z'),
  (tests.id('o2'), tests.id('cust'), 4, null,    '2020-03-10 21:00Z'),
  (tests.id('o3'), tests.id('cust'), 3, 'وسط',   '2020-03-11 06:00Z'),
  (tests.id('o4'), tests.id('cust'), 2, 'ضعيف',  '2020-03-11 07:00Z'),
  (tests.id('o5'), tests.id('cust'), 1, null,    '2020-03-12 06:00Z'),
  (tests.id('o6'), tests.id('cust'), 5, 'رائع',  '2020-03-12 06:00Z');
select tests.as_user(tests.id('staff'));

select is(public.ratings_summary('2020-03-10', '2020-03-12'),
  '{"count": 6, "avg": 3.3, "distribution": {"1": 1, "2": 1, "3": 1, "4": 1, "5": 2}}'::jsonb,
  'summary 10..12: 6 ratings, average 20/6 = 3.3 (one decimal), distribution');
select is(public.ratings_summary('2020-03-10', '2020-03-10'),
  '{"count": 1, "avg": 5.0, "distribution": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 1}}'::jsonb,
  'day 10: a rating at 23:59 Baghdad belongs to day 10');
select is(public.ratings_summary('2020-03-11', '2020-03-11'),
  '{"count": 3, "avg": 3.0, "distribution": {"1": 0, "2": 1, "3": 1, "4": 1, "5": 0}}'::jsonb,
  'day 11: a rating at 00:00 Baghdad belongs to day 11 (r2, r3, r4)');
select is(public.ratings_summary('2020-03-13', '2020-03-13'),
  '{"count": 0, "avg": null, "distribution": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}}'::jsonb,
  'an empty day: zero count, null average (not 0)');
select is(public.ratings_summary('2020-03-10', '2020-03-12', 1, 2),
  '{"count": 2, "avg": 1.5, "distribution": {"1": 1, "2": 1, "3": 0, "4": 0, "5": 0}}'::jsonb, 'stars 1..2 filter applies to the figures too');
select is(public.ratings_summary('2020-03-10', '2020-03-12', 1, 5, true),
  '{"count": 4, "avg": 3.8, "distribution": {"1": 0, "2": 1, "3": 1, "4": 0, "5": 2}}'::jsonb, 'with-comment filter: 4 ratings, average 3.75 -> 3.8');
select is((public.ratings_summary() ->> 'count')::int, 6, 'no range = all time (test data only; 2020 days)') ;

select is(
  (select jsonb_agg(jsonb_build_object('stars', stars, 'comment', comment, 'n', order_number is not null, 'who', customer_name is not null)
                    order by created_at desc, order_id desc)
     from public.ratings_list('2020-03-10', '2020-03-10')),
  '[{"stars": 5, "comment": "ممتاز", "n": true, "who": true}]'::jsonb, 'list day 10: the 23:59 rating with its order number and customer');
select is((select count(*)::int from public.ratings_list('2020-03-10', '2020-03-12')), 6, 'list 10..12: all six');
select is((select (array_agg(created_at order by created_at desc))[1] from public.ratings_list('2020-03-10', '2020-03-12')), '2020-03-12 06:00Z'::timestamptz, 'newest first');
select is((select count(*)::int from public.ratings_list('2020-03-10', '2020-03-12', 1, 2)), 2, 'list: 1..2 stars only');
select is((select count(*)::int from public.ratings_list('2020-03-10', '2020-03-12', 1, 5, true)), 4, 'list: with comment only');
select is((select count(*)::int from public.ratings_list('2020-03-10', '2020-03-12', 1, 5, false, null, null, 0)), 1, 'limit is clamped to at least 1');
-- keyset: صفحتان بحجم 4 بلا تكرار ولا فقد، بما فيها التعادل بالوقت (r5/r6)
select is(
  (select count(*)::int from (
     select order_id from public.ratings_list('2020-03-10', '2020-03-12', 1, 5, false, null, null, 4)
     union all
     select p2.order_id
       from (select created_at c, order_id o from public.ratings_list('2020-03-10', '2020-03-12', 1, 5, false, null, null, 4)
              order by created_at, order_id limit 1) lst,
            lateral public.ratings_list('2020-03-10', '2020-03-12', 1, 5, false, lst.c, lst.o, 4) p2) x),
  6, 'keyset: page 1 (4) + page 2 (2) = 6');
select is(
  (select count(distinct order_id)::int from (
     select order_id from public.ratings_list('2020-03-10', '2020-03-12', 1, 5, false, null, null, 4)
     union all
     select p2.order_id
       from (select created_at c, order_id o from public.ratings_list('2020-03-10', '2020-03-12', 1, 5, false, null, null, 4)
              order by created_at, order_id limit 1) lst,
            lateral public.ratings_list('2020-03-10', '2020-03-12', 1, 5, false, lst.c, lst.o, 4) p2) x),
  6, 'keyset: no duplicates and nothing lost across the tie at the same created_at');

-- نفس الأرقام بالتقارير (الأدمن): report_summary يستدعي نفس الحساب
select tests.as_user(tests.id('admin'));
select is(
  (select jsonb_build_object('n', s ->> 'rating_count', 'avg', s -> 'rating_avg') from (select public.report_summary('2020-03-10', '2020-03-12') s) x),
  jsonb_build_object('n', '6', 'avg', 3.3), 'report_summary shows the same count and average as ratings_summary');
select is(
  (select jsonb_build_object('n', (public.ratings_summary('2020-03-10', '2020-03-12') ->> 'count'),
                             'avg', public.ratings_summary('2020-03-10', '2020-03-12') -> 'avg')),
  jsonb_build_object('n', '6', 'avg', 3.3), 'and the ratings screen figures are the same numbers');
select is(
  (select count(*)::int from public.ratings_list('2020-03-10', '2020-03-12', 1, 5, true, null, null, 20)),
  (select (public.ratings_summary('2020-03-10', '2020-03-12', 1, 5, true) ->> 'count')::int),
  'last comments (reports) = the with-comment count of the summary');

-- ================================================================ 5) الأخطاء والصلاحيات
select throws_ok($$ select public.ratings_summary('2020-03-12', '2020-03-10') $$, 'INVALID_DATE_RANGE', 'from after to');
select throws_ok($$ select public.ratings_summary(null, null, 3, 2) $$, 'INVALID_STARS', 'min stars above max');
select throws_ok($$ select public.ratings_summary(null, null, 0, 5) $$, 'INVALID_STARS', 'min stars 0');
select throws_ok($$ select * from public.ratings_list(null, null, 1, 6) $$, 'INVALID_STARS', 'max stars 6');
select tests.as_user(tests.id('cust'));
select throws_ok($$ select public.ratings_summary() $$, '42501', 'NOT_ALLOWED', 'customer: no summary');
select throws_ok($$ select * from public.ratings_list() $$, '42501', 'NOT_ALLOWED', 'customer: no list');
select tests.as_user(tests.id('drv'));
select throws_ok($$ select public.ratings_summary() $$, '42501', 'NOT_ALLOWED', 'driver: no summary');
select throws_ok($$ select * from public.ratings_list() $$, '42501', 'NOT_ALLOWED', 'driver: no list');
select tests.as_anon();
select throws_ok($$ select public.ratings_summary() $$, '42501', null, 'anon: no summary');
select tests.as_postgres();
update public.profiles set must_change_pin = true where id in (tests.id('admin2'), tests.id('staff2'));
select tests.as_user(tests.id('admin2'));
select throws_ok($$ select public.ratings_summary() $$, '42501', 'NOT_ALLOWED', 'flagged admin: no summary');
select tests.as_user(tests.id('staff2'));
select throws_ok($$ select * from public.ratings_list() $$, '42501', 'NOT_ALLOWED', 'flagged staff: no list');
select tests.as_postgres();
update public.profiles set must_change_pin = false, is_active = false where id = tests.id('staff2');
select tests.as_user(tests.id('staff2'));
select throws_ok($$ select public.ratings_summary() $$, '42501', 'NOT_ALLOWED', 'deactivated staff: no summary');
select tests.as_postgres();
select is(has_function_privilege('authenticated', 'private.ratings_stats(timestamptz, timestamptz, int, int, boolean)', 'execute'), false,
  'the internal stats function is not callable by authenticated');

select * from finish();
