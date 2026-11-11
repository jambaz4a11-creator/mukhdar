-- 10: سياسات Storage لصور المنتجات (bucket عام: العرض بالرابط العام، لا بقائمة الملفات)
select plan(12);

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('cust', tests.new_user('customer'));
insert into storage.objects (bucket_id, name) values ('product-images', 'tests/listing-probe.png');

select is((select public from storage.buckets where id = 'product-images'), true,
  'product-images is a public bucket (images served by public URL)');

select tests.as_anon();
select is_empty($$ select 1 from storage.objects where bucket_id = 'product-images' $$,
  'anon cannot list product images');

select tests.as_user(tests.id('cust'));
select is_empty($$ select 1 from storage.objects where bucket_id = 'product-images' $$,
  'customer cannot list product images');

select tests.as_user(tests.id('admin'));
select isnt_empty($$ select 1 from storage.objects
                     where bucket_id = 'product-images' and name = 'tests/listing-probe.png' $$,
  'admin can list product images');

select tests.as_postgres();
select is((select count(*)::int from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
              and roles @> array['public']::name[]),
  0, 'no public SELECT policy on storage.objects');

-- ---------------------------------------------------------------- رفع/تعديل/حذف: للأدمن فقط
-- الحذف المباشر من storage.objects ممنوع افتراضياً (trigger protect_delete)؛ نسمح به هنا لاختبار RLS.
select set_config('storage.allow_delete_query', 'true', true);

select tests.as_user(tests.id('admin'));
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('product-images', 'tests/admin-upload.png') $$,
  'admin uploads a product image');

select tests.as_user(tests.id('cust'));
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('product-images', 'tests/cust-upload.png') $$,
  '42501', null, 'customer cannot upload a product image');
select is(tests.affected($$ update storage.objects set metadata = '{"x": 1}'
                            where bucket_id = 'product-images' and name = 'tests/admin-upload.png' $$),
  0, 'customer cannot update a product image');
select is(tests.affected($$ delete from storage.objects
                            where bucket_id = 'product-images' and name = 'tests/admin-upload.png' $$),
  0, 'customer cannot delete a product image');

select tests.as_anon();
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('product-images', 'tests/anon-upload.png') $$,
  '42501', null, 'anon cannot upload a product image');

select tests.as_user(tests.id('admin'));
select is(tests.affected($$ update storage.objects set metadata = '{"x": 1}'
                            where bucket_id = 'product-images' and name = 'tests/admin-upload.png' $$),
  1, 'admin updates a product image');
select is(tests.affected($$ delete from storage.objects
                            where bucket_id = 'product-images' and name = 'tests/admin-upload.png' $$),
  1, 'admin deletes a product image');

select * from finish();
