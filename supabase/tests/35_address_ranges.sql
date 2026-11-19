-- 35: نطاقات بسماية بالعنوان (migration 20261207000001): الطابق G..9، الشقة 1..12، بلوك فعّال، عمارة ببلوكها الفعّال.
-- كل الكتابات بدور الزبون الحقيقي (قاعدة CLAUDE.md)؛ دور postgres للتجهيز فقط.
select plan(20);

select tests.remember('cust', tests.new_user('customer'));
-- عنوان قديم غير صالح (طابق 15، شقة 26) كما بقي على dev، بدور المالك (بتعطيل trigger التنظيف مؤقتاً للتجهيز)
select tests.remember('old', tests.new_address(tests.id('cust')));
alter table public.addresses disable trigger addresses_clean_text;
update public.addresses set floor = 15, apartment = '26' where id = tests.id('old');
alter table public.addresses enable trigger addresses_clean_text;

-- بلوك فعّال بعمارة فعّالة وعمارة مخفية، وبلوك مخفي بعمارة
create function tests.t35_tree() returns void language plpgsql as $$
declare v_sec int; v_sub_on int; v_sub_off int; v_id int;
begin
  insert into public.sectors (name) values ('t35-sector ' || gen_random_uuid()) returning id into v_sec;
  insert into public.subsections (sector_id, name) values (v_sec, 'A1') returning id into v_sub_on;
  insert into public.subsections (sector_id, name, is_active) values (v_sec, 'B4', false) returning id into v_sub_off;
  insert into public.buildings (subsection_id, number) values (v_sub_on, '3') returning id into v_id;
  perform set_config('t.b_ok', v_id::text, true);
  insert into public.buildings (subsection_id, number, is_active) values (v_sub_on, '40', false) returning id into v_id;
  perform set_config('t.b_hidden_building', v_id::text, true);
  insert into public.buildings (subsection_id, number) values (v_sub_off, '5') returning id into v_id;
  perform set_config('t.b_hidden_block', v_id::text, true);
end $$;
select tests.t35_tree();

select tests.as_user_aal1(tests.id('cust'));

-- الطابق
select lives_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 0, '1') $$,
                       tests.id('cust'), current_setting('t.b_ok')), 'floor 0 (G) is accepted');
select lives_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 9, '12') $$,
                       tests.id('cust'), current_setting('t.b_ok')), 'floor 9 and apartment 12 are accepted');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 10, '5') $$,
                        tests.id('cust'), current_setting('t.b_ok')), 'P0001', 'FLOOR_INVALID', 'floor 10 is refused');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 20, '5') $$,
                        tests.id('cust'), current_setting('t.b_ok')), 'P0001', 'FLOOR_INVALID', 'floor 20 (old limit) is refused');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, -1, '5') $$,
                        tests.id('cust'), current_setting('t.b_ok')), 'P0001', 'FLOOR_INVALID', 'negative floor is refused');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, apartment) values (%L, %s, '5') $$,
                        tests.id('cust'), current_setting('t.b_ok')), 'P0001', 'FLOOR_REQUIRED', 'missing floor is still refused');

-- الشقة
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 1, '0') $$,
                        tests.id('cust'), current_setting('t.b_ok')), 'P0001', 'APARTMENT_INVALID', 'apartment 0 is refused');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 1, '13') $$,
                        tests.id('cust'), current_setting('t.b_ok')), 'P0001', 'APARTMENT_INVALID', 'apartment 13 is refused');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 1, '5A') $$,
                        tests.id('cust'), current_setting('t.b_ok')), 'P0001', 'APARTMENT_INVALID', 'free-text apartment is refused');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 1, %L) $$,
                        tests.id('cust'), current_setting('t.b_ok'), '٥'), 'P0001', 'APARTMENT_INVALID', 'Arabic-Indic digit apartment is refused');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 1, '') $$,
                        tests.id('cust'), current_setting('t.b_ok')), 'P0001', 'APARTMENT_INVALID', 'empty apartment is refused');

-- العمارة والبلوك
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 1, '5') $$,
                        tests.id('cust'), current_setting('t.b_hidden_building')), 'P0001', 'BUILDING_INACTIVE',
  'a building outside the 1..N of its block (hidden) is refused');
select throws_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 1, '5') $$,
                        tests.id('cust'), current_setting('t.b_hidden_block')), 'P0001', 'BUILDING_INACTIVE',
  'a building of a hidden block is refused');

-- التعديل
select tests.remember('new', (select id from public.addresses where customer_id = tests.id('cust') and apartment = '1'));
select throws_ok(format($$ update public.addresses set floor = 12 where id = %L $$, tests.id('new')), 'P0001', 'FLOOR_INVALID',
  'editing the floor to 12 is refused');
select throws_ok(format($$ update public.addresses set apartment = '30' where id = %L $$, tests.id('new')), 'P0001', 'APARTMENT_INVALID',
  'editing the apartment to 30 is refused');
select throws_ok(format($$ update public.addresses set building_id = %s where id = %L $$, current_setting('t.b_hidden_block'), tests.id('new')),
  'P0001', 'BUILDING_INACTIVE', 'moving to a hidden block is refused');
select lives_ok(format($$ update public.addresses set floor = 4, apartment = '7' where id = %L $$, tests.id('new')),
  'editing to valid values works');

-- العنوان القديم غير الصالح: حفظه بنفس القيم أو جعله افتراضياً لا يُعترض، وتغييره لقيمة أخرى غير صالحة مرفوض
select lives_ok(format($$ update public.addresses set note = 'جنب المصعد', floor = 15, apartment = '26' where id = %L $$, tests.id('old')),
  'old invalid address: saving it with the same (unchanged) values is not blocked');
select lives_ok(format($$ select public.set_default_address(%L) $$, tests.id('old')),
  'old invalid address: can still be made default');
select throws_ok(format($$ update public.addresses set apartment = '27' where id = %L $$, tests.id('old')), 'P0001', 'APARTMENT_INVALID',
  'old invalid address: changing it to another invalid value is refused');

select * from finish();
