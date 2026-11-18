-- 34: إدارة الأقسام (migration 20261206000001): أدمن فقط عبر الدوال، بدوره الحقيقي (aal2 / aal1 / موظف / زبون)،
-- تدقيق admin_audit، لا حذف لقسم فيه منتجات، وإخفاء القسم يخفي منتجاته عن الزبون (قراءة وطلب).
select plan(52);

create function tests.remember_int(p_name text, p_id int) returns int language sql as $$
  select set_config('t.' || p_name, p_id::text, true)::int
$$;
create function tests.int(p_name text) returns int language sql stable as $$
  select current_setting('t.' || p_name)::int
$$;
grant execute on function tests.remember_int(text, int), tests.int(text) to anon, authenticated, service_role;

update public.app_settings set min_order_iqd = 0, store_open = true;
select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('cust', tests.new_user('customer'));
select tests.remember('addr', tests.new_address(tests.id('cust')));
-- منتج نشط بقسم ظاهر (التجهيز بدور postgres)
select tests.remember('prod', tests.new_product(1000, 20, true, 500));
select set_config('t.cat', (select category_id::text from public.products where id = tests.id('prod')), true);

-- ================================================================ من لا يملك الصلاحية
select tests.as_user(tests.id('staff'));
select throws_ok($$ select public.admin_save_category('{"name": "x"}'::jsonb) $$, 'NOT_ALLOWED', 'staff cannot save a category');
select throws_ok($$ select public.delete_category(1) $$, 'NOT_ALLOWED', 'staff cannot delete a category');
select throws_ok($$ select public.reorder_categories(array[1]) $$, 'NOT_ALLOWED', 'staff cannot reorder categories');
select tests.as_user(tests.id('cust'));
select throws_ok($$ select public.admin_save_category('{"name": "x"}'::jsonb) $$, 'NOT_ALLOWED', 'customer cannot save a category');
select tests.as_user_aal1(tests.id('admin'));
select throws_ok($$ select public.admin_save_category('{"name": "x"}'::jsonb) $$, 'NOT_ALLOWED', 'admin aal1 cannot save a category');
select throws_ok($$ select public.delete_category(1) $$, 'NOT_ALLOWED', 'admin aal1 cannot delete a category');

-- ================================================================ الأدمن (aal2): لا كتابة مباشرة
select tests.as_user(tests.id('admin'));
select throws_ok($$ insert into public.categories (name) values ('direct') $$, '42501', null, 'admin cannot insert into categories directly');
select throws_ok($$ update public.categories set name = 'direct' $$, '42501', null, 'admin cannot update categories directly');
select throws_ok($$ delete from public.categories $$, '42501', null, 'admin cannot delete from categories directly');

-- ================================================================ إضافة
select tests.remember_int('new1', (select public.admin_save_category('{"name": "  قسم اختبار  "}'::jsonb)));
select is((select name from public.categories where id = tests.int('new1')), 'قسم اختبار', 'new category: name is trimmed');
select is((select sort_order from public.categories where id = tests.int('new1')),
          (select max(sort_order) from public.categories), 'new category: goes last (max + 1)');
select ok((select is_active from public.categories where id = tests.int('new1')), 'new category: visible by default');

select throws_ok($$ select public.admin_save_category('{"name": "   "}'::jsonb) $$, 'INVALID_CATEGORY', 'empty name is refused');
select throws_ok(format($$ select public.admin_save_category(jsonb_build_object('name', %L)) $$, repeat('ا', 41)),
  'INVALID_CATEGORY', 'a name longer than 40 is refused');
select throws_ok($$ select public.admin_save_category('{"name": 5}'::jsonb) $$, 'INVALID_CATEGORY', 'a non-string name is refused');
select throws_ok($$ select public.admin_save_category('{"name": "ok", "vendor_id": null}'::jsonb) $$, 'INVALID_CATEGORY', 'unknown keys are refused');
select throws_ok($$ select public.admin_save_category('{"name": "ok", "image_path": "categories/1/x.webp"}'::jsonb) $$,
  'INVALID_CATEGORY', 'an image cannot be set while creating (its path carries the id)');
select throws_ok($$ select public.admin_save_category('{"name": " قسم اختبار "}'::jsonb) $$, 'CATEGORY_NAME_TAKEN', 'duplicate name is refused');
select lives_ok($$ select public.admin_save_category('{"name": "Case Test"}'::jsonb) $$, 'a Latin-named category is added');
select throws_ok($$ select public.admin_save_category('{"name": "CASE TEST"}'::jsonb) $$,
  'CATEGORY_NAME_TAKEN', 'duplicate name is refused regardless of letter case');

-- ================================================================ تعديل + تدقيق
select lives_ok(format($$ select public.admin_save_category(jsonb_build_object('id', %s, 'name', 'قسم معدّل')) $$, tests.int('new1')),
  'rename a category');
select is((select name from public.categories where id = tests.int('new1')), 'قسم معدّل', 'renamed');
select throws_ok(format($$ select public.admin_save_category(jsonb_build_object('id', %s, 'name', 'قسم معدّل')) $$, current_setting('t.cat')),
  'CATEGORY_NAME_TAKEN', 'rename to an existing name is refused');
select throws_ok($$ select public.admin_save_category('{"id": 999999, "name": "x"}'::jsonb) $$, 'CATEGORY_NOT_FOUND', 'unknown category id');
select is((select count(*)::int from public.admin_audit where action = 'category' and after ->> 'op' = 'update'
            and (after ->> 'id')::int = tests.int('new1') and before ->> 'name' = 'قسم اختبار' and after ->> 'name' = 'قسم معدّل'),
          1, 'audit: the rename is recorded with before and after');
select lives_ok(format($$ select public.admin_save_category(jsonb_build_object('id', %s, 'name', 'قسم معدّل')) $$, tests.int('new1')),
  'saving the same values again is fine');
select is((select count(*)::int from public.admin_audit where action = 'category' and (after ->> 'id')::int = tests.int('new1') and after ->> 'op' = 'update'),
          1, 'audit: an unchanged save writes nothing');

-- الصورة: مسار هذا القسم فقط
select throws_ok(format($$ select public.admin_save_category(jsonb_build_object('id', %s, 'image_path', 'categories/%s/a.webp')) $$,
                        tests.int('new1'), current_setting('t.cat')), 'INVALID_CATEGORY', 'an image path of another category is refused');
select lives_ok(format($$ select public.admin_save_category(jsonb_build_object('id', %s, 'image_path', 'categories/%s/a.webp')) $$,
                       tests.int('new1'), tests.int('new1')), 'own image path is accepted');
select is((select image_path from public.categories where id = tests.int('new1')), format('categories/%s/a.webp', tests.int('new1')), 'image saved');

-- ================================================================ الإخفاء/الإظهار يؤثر على منتجات القسم عند الزبون
select tests.as_user(tests.id('cust'));
select isnt_empty($$ select 1 from public.products where id = tests.id('prod') $$, 'customer sees a product of a visible category');
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.admin_save_category(jsonb_build_object('id', %s, 'is_active', false)) $$, current_setting('t.cat')),
  'admin hides the category');
select tests.as_user(tests.id('cust'));
select is_empty(format($$ select 1 from public.categories where id = %s $$, current_setting('t.cat')), 'customer does not see the hidden category');
select is_empty($$ select 1 from public.products where id = tests.id('prod') $$, 'customer does not see the products of a hidden category');
select throws_ok(format($$ select public.place_order(%L, jsonb_build_array(tests.item(%L, 1)), gen_random_uuid()) $$,
                        tests.id('addr'), tests.id('prod')), 'PRODUCT_UNAVAILABLE', 'customer cannot order a product of a hidden category');
select tests.as_user(tests.id('staff'));
select isnt_empty($$ select 1 from public.products where id = tests.id('prod') $$, 'staff still sees the product of a hidden category');
select tests.as_user(tests.id('admin'));
select is((select count(*)::int from public.products where category_id = current_setting('t.cat')::int), 1, 'admin: the product is kept in the hidden category');
select lives_ok(format($$ select public.admin_save_category(jsonb_build_object('id', %s, 'is_active', true)) $$, current_setting('t.cat')),
  'admin shows the category again');
select tests.as_user(tests.id('cust'));
select isnt_empty($$ select 1 from public.products where id = tests.id('prod') $$, 'the product is visible again');

-- ================================================================ الحذف
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ select public.delete_category(%s) $$, current_setting('t.cat')), 'CATEGORY_HAS_PRODUCTS',
  'a category with products cannot be deleted (hide it instead)');
select is(public.delete_category(tests.int('new1')), format('categories/%s/a.webp', tests.int('new1')),
  'an empty category is deleted and its image path returned');
select is((select count(*)::int from public.categories where id = tests.int('new1')), 0, 'the empty category is gone');
select is((select count(*)::int from public.admin_audit where action = 'category' and before ->> 'op' = 'delete'
            and (before ->> 'id')::int = tests.int('new1') and before ->> 'name' = 'قسم معدّل'),
          1, 'audit: the deletion is recorded');
select throws_ok($$ select public.delete_category(999999) $$, 'CATEGORY_NOT_FOUND', 'deleting an unknown category');

-- ================================================================ الترتيب
select tests.remember_int('n2', (select public.admin_save_category('{"name": "ترتيب ب"}'::jsonb)));
select tests.remember_int('n3', (select public.admin_save_category('{"name": "ترتيب ج"}'::jsonb)));
select set_config('t.exp', (select array_agg(id order by sort_order desc, id desc)::text from public.categories), true);
select lives_ok($$ select public.reorder_categories((select array_agg(id order by sort_order desc, id desc) from public.categories)) $$,
  'reverse the whole order');
select is((select array_agg(id order by sort_order)::text from public.categories), current_setting('t.exp'),
          'sort_order follows the submitted order');
select is((select count(*)::int from public.admin_audit where action = 'category' and after ->> 'op' = 'reorder'), 1, 'audit: the reorder is recorded once');
select lives_ok($$ select public.reorder_categories((select array_agg(id order by sort_order) from public.categories)) $$, 'the same order again');
select throws_ok($$ select public.reorder_categories((select array_agg(id) from public.categories where id <> tests.int('n2'))) $$,
  'INVALID_CATEGORY', 'a partial list is refused');
select throws_ok($$ select public.reorder_categories((select array_agg(id) || 999999 from public.categories)) $$,
  'INVALID_CATEGORY', 'an unknown id is refused');
select throws_ok($$ select public.reorder_categories((select array_agg(id) || tests.int('n2') from public.categories)) $$,
  'INVALID_CATEGORY', 'a duplicate id is refused');

-- ================================================================ التدقيق للأدمن فقط
select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.admin_audit), 0, 'staff cannot read admin_audit');

select * from finish();
