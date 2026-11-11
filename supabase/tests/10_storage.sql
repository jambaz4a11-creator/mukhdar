-- 10: سياسات Storage لصور المنتجات (bucket عام: العرض بالرابط العام، لا بقائمة الملفات)
select plan(5);

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

select * from finish();
