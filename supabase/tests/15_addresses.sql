-- 15: العناوين كما يستخدمها تطبيق الزبون (T12): نفس الاستعلامات التي يرسلها التطبيق، بدور authenticated.
-- العزل بين الزبائن مغطى بـ 02؛ هنا يُعاد كاختبار سريع، مع قاعدة "عنوان افتراضي واحد" وتدفق تعيينه.
select plan(16);

-- التجهيز (postgres)
select tests.remember('c1', tests.new_user('customer'));
select tests.remember('c2', tests.new_user('customer'));
select tests.remember('a1', tests.new_address(tests.id('c1')));
select tests.remember('a2', tests.new_address(tests.id('c2')));
update public.addresses set is_default = true where id = tests.id('a2');
select set_config('t.bld', (select building_id::text from public.addresses where id = tests.id('a1')), true);
select set_config('t.sub', (select subsection_id::text from public.buildings
                             where id = current_setting('t.bld')::int), true);
insert into public.buildings (subsection_id, number, is_active)
values (current_setting('t.sub')::int, '77', false);

-- ---------------------------------------------------------------- القوائم (بدون دخول)
select tests.as_anon();
select results_eq(
  format($$ select number from public.buildings where subsection_id = %s order by number $$,
         current_setting('t.sub')),
  array['12'], 'anon reads only the active buildings of a unit (77 is inactive)');

-- ---------------------------------------------------------------- الزبون c1
select tests.as_user(tests.id('c1'));
select results_eq(
  $$ select a.id from public.addresses a
       join public.buildings b on b.id = a.building_id
       join public.subsections ss on ss.id = b.subsection_id
       join public.sectors s on s.id = ss.sector_id $$,
  array[tests.id('a1')], 'the joined address list returns only own addresses');
select is(tests.affected(format($$ update public.addresses set apartment = '99' where id = %L $$, tests.id('a2'))),
  0, 'cannot edit another customer''s address');
select is(tests.affected(format($$ delete from public.addresses where id = %L $$, tests.id('a2'))),
  0, 'cannot delete another customer''s address');
select throws_ok(format($$ update public.addresses set customer_id = %L where id = %L $$, tests.id('c2'), tests.id('a1')),
  '42501', null, 'cannot move an address to another customer (customer_id not updatable)');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 1, '') $$,
                        tests.id('c1'), current_setting('t.bld')),
  '23514', null, 'an empty apartment is rejected');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 1, %L) $$,
                        tests.id('c1'), current_setting('t.bld'), repeat('9', 21)),
  '23514', null, 'an apartment longer than 20 characters is rejected');

-- عنوان جديد افتراضي: التطبيق يلغي الافتراضي القديم أولاً ثم يضيف
select lives_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment, is_default)
                         values (%L, %s, 1, '1', true) $$, tests.id('c1'), current_setting('t.bld')),
  'first default address');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment, is_default)
                          values (%L, %s, 1, '2', true) $$, tests.id('c1'), current_setting('t.bld')),
  '23505', null, 'a second default without clearing the first is rejected (one default per customer)');
select lives_ok(format($$ update public.addresses set is_default = false
                          where customer_id = %L and is_default $$, tests.id('c1')),
  'clear the old default (app step 1)');
select lives_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment, is_default)
                         values (%L, %s, 1, '2', true) $$, tests.id('c1'), current_setting('t.bld')),
  'then add the new default (app step 2)');

-- تعيين عنوان موجود افتراضياً (setDefaultAddress)
select lives_ok(format($$ update public.addresses set is_default = false
                          where customer_id = %L and is_default and id <> %L $$, tests.id('c1'), tests.id('a1')),
  'set default, step 1: clear the others');
select is(tests.affected(format($$ update public.addresses set is_default = true where id = %L $$, tests.id('a1'))),
  1, 'set default, step 2: mark this one');
select results_eq($$ select id from public.addresses where is_default $$, array[tests.id('a1')],
  'exactly one default for the customer');

-- ---------------------------------------------------------------- تأثير c1 على c2
select tests.as_postgres();
select results_eq(format($$ select is_default from public.addresses where id = %L $$, tests.id('a2')),
  array[true], 'clearing c1''s default never touches another customer''s default');
select is((select count(*)::int from public.addresses where customer_id = tests.id('c2')), 1,
  'the other customer''s address is still there');

select * from finish();
