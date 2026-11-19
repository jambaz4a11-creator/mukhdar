-- 32: كل كتابة يقوم بها المستخدم تُختبر **بدوره الحقيقي** (JWT زبون/موظف/أدمن aal2/سائق)، لا بدور postgres.
-- السبب: بلاغ iOS Safari (2026-11-18): حفظ الاسم وإضافة العنوان فشلا للزبون بـ 42501 لأن trigger التنظيف
-- (SECURITY INVOKER) يستدعي private.clean_user_text المسحوبة؛ الاختبارات القديمة كانت تكتب بدور المالك
-- فلم تكشفه. (migration 20261203000001، قاعدة CLAUDE.md "اختبارات الكتابة بالدور الحقيقي".)
-- التجهيز فقط (مستخدمون، منتج، عمارة) بدور postgres؛ كل كتابة يقوم بها التطبيق أو اللوحة أو السائق بدوره.
-- بالنهاية فحوص آلية للكتالوج تمنع رجوع نفس الصنف من الأخطاء بأي جدول مستقبلاً.
select plan(42);

-- ================================================================ التجهيز (postgres)
select tests.remember('cust',  tests.new_user('customer'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('admin', tests.new_user('admin'));
select tests.remember('drv',   tests.new_user('driver'));
-- زبون جديد كما يُنشئه التسجيل: بلا اسم بعد
update public.profiles set full_name = null where id = tests.id('cust');
select tests.remember('prod', tests.new_product(1000, 50, true, 500));

create function tests.t32_building() returns int language plpgsql as $$
declare v_sec int; v_sub int; v_bld int;
begin
  insert into public.sectors (name) values ('t32-sector ' || gen_random_uuid()) returning id into v_sec;
  insert into public.subsections (sector_id, name) values (v_sec, 'A1') returning id into v_sub;
  insert into public.buildings (subsection_id, number) values (v_sub, '7') returning id into v_bld;
  perform set_config('t.sec', v_sec::text, true);
  perform set_config('t.sub', v_sub::text, true);
  return v_bld;
end $$;
select set_config('t.bld', tests.t32_building()::text, true);

-- ================================================================ الزبون (authenticated، aal1 مثل التطبيق)
select tests.as_user_aal1(tests.id('cust'));

-- الاسم بعد التسجيل (شاشة auth/name وحسابي ← الاسم)
select lives_ok(format($$ update public.profiles set full_name = %L where id = %L $$,
                       E'  سارة‏ علي ', tests.id('cust')),
  'customer: saves their name after sign-up (as authenticated)');
select is((select full_name from public.profiles where id = tests.id('cust')), 'سارة علي',
  'customer: the name is cleaned by the trigger');

-- العنوان: إضافة، تعديل، افتراضي، حذف
select lives_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment, label, note)
                          values (%L, %s, 2, %L, %L, %L) $$,
                       tests.id('cust'), current_setting('t.bld'), E' 4‮ ', 'البيت', 'الباب الأخضر'),
  'customer: adds an address');
select tests.remember('addr', (select id from public.addresses where customer_id = tests.id('cust') limit 1));
select is((select apartment from public.addresses where id = tests.id('addr')), '4',
  'customer: apartment is cleaned by the trigger');
select lives_ok(format($$ update public.addresses set apartment = '5', floor = 3, note = 'جنب المصعد' where id = %L $$, tests.id('addr')),
  'customer: edits the address');
select lives_ok(format($$ select public.set_default_address(%L) $$, tests.id('addr')),
  'customer: sets the default address');
select lives_ok(format($$ insert into public.addresses (customer_id, building_id, floor, apartment) values (%L, %s, 0, '9') $$,
                       tests.id('cust'), current_setting('t.bld')),
  'customer: adds a second address');
select is(tests.affected(format($$ delete from public.addresses where customer_id = %L and apartment = '9' $$,
                                tests.id('cust'))), 1,
  'customer: deletes the second address');

-- الطلب والإلغاء
select lives_ok(format($$ select tests.remember('o1', (public.place_order(%L, %L::jsonb, gen_random_uuid(), 'بدون أكياس') ->> 'order_id')::uuid) $$,
                       tests.id('addr'), jsonb_build_array(tests.item(tests.id('prod'), 2))),
  'customer: places an order');
select lives_ok(format($$ select tests.remember('o2', (public.place_order(%L, %L::jsonb, gen_random_uuid()) ->> 'order_id')::uuid) $$,
                       tests.id('addr'), jsonb_build_array(tests.item(tests.id('prod'), 1))),
  'customer: places a second order');
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled') $$, tests.id('o2')),
  'customer: cancels a pending order');

-- ================================================================ الموظف (aal2)
select tests.as_user(tests.id('staff'));
select lives_ok(format($$ select public.set_order_status(%L, 'preparing') $$, tests.id('o1')),
  'staff: starts preparing');
select lives_ok(format($$ select public.set_order_status(%L, 'ready') $$, tests.id('o1')),
  'staff: marks the order ready');
select throws_ok($$ select public.update_app_settings('{"delivery_fee_iqd": 1500}'::jsonb) $$, '42501', null,
  'staff: settings are admin-only (42501)');
select throws_ok(format($$ select public.adjust_stock_bulk(jsonb_build_array(jsonb_build_object('product_id', %L::text, 'qty', -1)), 'waste') $$,
                        tests.id('prod')), '42501', null,
  'staff: waste is admin-only (42501)');
select throws_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'price_iqd', 1250)) $$,
                        tests.id('prod')), '42501', null,
  'staff: product edits are admin-only (42501)');

-- ================================================================ السائق (aal1، apps/driver)
select tests.as_user_aal1(tests.id('drv'));
select lives_ok(format($$ select public.accept_order(%L) $$, tests.id('o1')), 'driver: accepts a ready order');
select lives_ok(format($$ select public.set_order_status(%L, 'out_for_delivery') $$, tests.id('o1')),
  'driver: on the way');
select lives_ok(format($$ select public.set_order_status(%L, 'delivered') $$, tests.id('o1')),
  'driver: delivered');

-- ================================================================ الزبون يقيّم
select tests.as_user_aal1(tests.id('cust'));
select lives_ok(format($$ select public.rate_order(%L, 5, %L) $$, tests.id('o1'), E'ممتاز⁦'),
  'customer: rates the delivered order');

-- ================================================================ الأدمن (aal2)
select tests.as_user(tests.id('admin'));
select lives_ok($$ select public.update_app_settings('{"delivery_fee_iqd": 1500}'::jsonb) $$,
  'admin: saves settings');
select lives_ok(format($$ select public.admin_save_product(jsonb_build_object('id', %L::text, 'price_iqd', 1250)) $$,
                       tests.id('prod')),
  'admin: edits a product price');
select lives_ok(format($$ select public.admin_save_product(jsonb_build_object(
                            'category_id', (select category_id from public.products where id = %L), 'name', 'T32 خيار',
                            'unit', 'نص كيلو', 'price_iqd', 1000, 'cost_iqd', 500, 'low_stock_threshold', 4)) $$,
                       tests.id('prod')),
  'admin: creates a product');
select lives_ok(format($$ select public.adjust_stock(%L, 10, 'purchase', null, 500) $$, tests.id('prod')),
  'admin: records a purchase');
select lives_ok(format($$ select public.adjust_stock_bulk(jsonb_build_array(jsonb_build_object('product_id', %L::text, 'qty', -1)), 'waste', 'تالف') $$,
                       tests.id('prod')),
  'admin: records daily waste');
select lives_ok($$ select public.admin_save_category('{"name": "T32 قسم"}'::jsonb) $$, 'admin: adds a category (function)');
select lives_ok(format($$ update public.subsections set is_active = false where id = %s $$, current_setting('t.sub')),
  'admin: hides a unit (audit trigger)');
select lives_ok(format($$ select public.add_buildings(%s, array['8', '9']) $$, current_setting('t.sub')),
  'admin: adds buildings');

-- ================================================================ تسجيل سائق (T27): الجهاز anon، Edge Functions service_role، الأدمن aal2
select tests.as_postgres();
select set_config('t.dphone', nextval('tests.phone_seq')::text, true);
select set_config('t.dsecret', repeat('k', 43), true);
select tests.as_service();
select lives_ok(format($$ select set_config('t.dreq', public.submit_driver_request(%L, 'سائق T32', %L, null)::text, true) $$,
                       current_setting('t.dphone'), encode(sha256(convert_to(current_setting('t.dsecret'), 'UTF8')), 'hex')),
  'service_role (driver-register): submits a driver request');
select tests.as_anon();
select is(public.driver_request_status(current_setting('t.dreq')::uuid, current_setting('t.dsecret')), 'pending',
  'anon (device without an account): reads its request status');
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.decide_driver_request(%L, true) $$, current_setting('t.dreq')),
  'admin: approves the driver request (audited)');
select tests.as_service();
select lives_ok(format($$ select * from public.begin_driver_completion(%L, %L) $$, current_setting('t.dreq'),
                       encode(sha256(convert_to(current_setting('t.dsecret'), 'UTF8')), 'hex')),
  'service_role (driver-complete-registration): begins completion');
select tests.as_postgres();
-- auth.admin.createUser بـ GoTrue (supabase_auth_admin)، ليس دوراً للمستخدم
select tests.remember('drv2', gen_random_uuid());
insert into auth.users (id, phone, aud, role) values (tests.id('drv2'), current_setting('t.dphone'), 'authenticated', 'authenticated');
select tests.as_service();
select lives_ok(format($$ select public.finish_driver_registration(%L, %L) $$, current_setting('t.dreq'), tests.id('drv2')),
  'service_role: finishes the registration (profile becomes a driver)');
select tests.as_user_aal1(tests.id('drv2'));
select lives_ok($$ select * from public.available_orders(5) $$, 'new driver (aal1): lists available orders');
select lives_ok($$ select public.register_push_token('ExponentPushToken[t32-drv2]', 'android') $$,
  'new driver (aal1): registers a push token');

-- ================================================================ حذف الحساب (delete-account: service_role ثم GoTrue)
select tests.as_service();
select lives_ok(format($$ select public.begin_account_deletion(%L) $$, tests.id('cust')),
  'service_role (delete-account): accepts the customer');
select tests.as_postgres();
-- الخطوة الثانية ينفّذها GoTrue (auth.admin.deleteUser) بدور supabase_auth_admin، ليست دوراً للمستخدم
select lives_ok(format($$ delete from auth.users where id = %L $$, tests.id('cust')),
  'auth: the user is deleted (profile cascade + anonymize trigger)');
select is((select customer_name from public.orders where id = tests.id('o1')), null,
  'deleted customer: the order is anonymized');

-- ================================================================ حارس الصنف: لا اعتماد على ما لا يصل إليه الدور
-- (1) دالة trigger SECURITY INVOKER على جدول public/private لا تستدعي شيئاً من private
select is(
  (select coalesce(string_agg(distinct p.oid::regprocedure::text, ', '), '')
     from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname in ('public', 'private') and not p.prosecdef
      and p.prosrc ~* 'private\.'),
  '', 'no SECURITY INVOKER trigger function calls into the private schema');
-- (2) كل دالة تعتمد عليها سياسة RLS قابلة للتنفيذ من authenticated (وanon لسياسات PUBLIC)
select is(
  (select coalesce(string_agg(distinct pol.polname || ' -> ' || d.refobjid::regprocedure::text, ', '), '')
     from pg_policy pol
     join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid and d.refclassid = 'pg_proc'::regclass
    where not has_function_privilege('authenticated', d.refobjid, 'execute')
       or (0 = any (pol.polroles) and not has_function_privilege('anon', d.refobjid, 'execute'))),
  '', 'every function used by an RLS policy is executable by the roles the policy applies to');
-- (3) كل دالة بقيمة افتراضية لعمود بـ public قابلة للتنفيذ من authenticated
select is(
  (select coalesce(string_agg(distinct d.refobjid::regprocedure::text, ', '), '')
     from pg_attrdef ad
     join pg_class c on c.oid = ad.adrelid and c.relnamespace = 'public'::regnamespace
     join pg_depend d on d.classid = 'pg_attrdef'::regclass and d.objid = ad.oid and d.refclassid = 'pg_proc'::regclass
    where not has_function_privilege('authenticated', d.refobjid, 'execute')),
  '', 'every function used by a column default is executable by authenticated');
-- (4) دالتا التنظيف: definer، search_path فارغ، ولا EXECUTE لأي دور
select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('private.tg_clean_profile_name()'::regprocedure, 'private.tg_clean_address_text()'::regprocedure)
      and p.prosecdef and p.proconfig = array['search_path=""']
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')),
  2, 'cleaning triggers are SECURITY DEFINER, search_path pinned, EXECUTE revoked from every role');

select * from finish();
