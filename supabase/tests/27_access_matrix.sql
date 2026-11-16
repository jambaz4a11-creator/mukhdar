-- 27: مصفوفة الصلاحيات (مراجعة C، L7): كل RPC جديدة من T20/T25/T26 × كل دور، بجدول واحد.
--   مجموعة "للموظف والأدمن": dashboard_today، ratings_summary، ratings_list.
--   مجموعة "أدمن فقط": report_* الست، stuck_notifications_count.
--   كل دور غير مسموح يجب أن يُرفض بـ 42501 (لا grant للزائر، أو NOT_ALLOWED من الدالة):
--   زائر، زبون، سائق، أدمن برمز مؤقت، أدمن معطّل، موظف برمز مؤقت، موظف معطّل، + الموظف الفعّال للمجموعة الثانية.
--   والمسموح يجب أن ينجح (حتى لا تكون المصفوفة فارغة المعنى).
--   دالة جديدة بهذه الأسماء لا تُضاف هنا ← الفحص الأخير يُفشل الاختبار حتى تُدرج.
--   (فحص search_path الثابت لكل دالة SECURITY DEFINER بـ public/private موجود بـ 01_schema.sql؛ يُعاد هنا بالتحديد.)
select plan(12);

-- ================================================================ المصفوفة
create function tests.matrix_try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- scope: 'staff' = للموظف والأدمن، 'admin' = أدمن فقط، 'all' = الاثنتان.
-- يرجع نصوص الاستدعاءات التي لم تعطِ النتيجة المتوقعة ('' إن لم يوجد)
create function tests.unexpected(p_scope text, p_expect text) returns text language sql as $$
  select coalesce(string_agg(f.sql, ' ; '), '')
    from (values
      ('staff', $q$ select public.dashboard_today() $q$),
      ('staff', $q$ select public.ratings_summary() $q$),
      ('staff', $q$ select * from public.ratings_list() $q$),
      ('admin', $q$ select public.report_summary(current_date - 7, current_date) $q$),
      ('admin', $q$ select * from public.report_daily(current_date - 7, current_date) $q$),
      ('admin', $q$ select * from public.report_orders_placed(current_date - 7, current_date) $q$),
      ('admin', $q$ select * from public.report_top_products(current_date - 7, current_date) $q$),
      ('admin', $q$ select * from public.report_drivers(current_date - 7, current_date) $q$),
      ('admin', $q$ select * from public.report_waste(current_date - 7, current_date) $q$),
      ('admin', $q$ select public.stuck_notifications_count() $q$)
    ) f(grp, sql)
   where (p_scope = 'all' or f.grp = p_scope)
     and tests.matrix_try(f.sql) is distinct from p_expect
$$;
grant execute on function tests.matrix_try(text), tests.unexpected(text, text) to anon, authenticated, service_role;

select tests.remember('cust',   tests.new_user('customer'));
select tests.remember('drv',    tests.new_user('driver'));
select tests.remember('admin',  tests.new_user('admin'));
select tests.remember('adm_f',  tests.new_user('admin'));
select tests.remember('adm_off', tests.new_user('admin'));
select tests.remember('staff',  tests.new_user('staff'));
select tests.remember('stf_f',  tests.new_user('staff'));
select tests.remember('stf_off', tests.new_user('staff'));
update public.profiles set must_change_pin = true where id in (tests.id('adm_f'), tests.id('stf_f'));
update public.profiles set is_active = false where id in (tests.id('adm_off'), tests.id('stf_off'));

-- ================================================================ المرفوضون (كل الدوال)
select tests.as_anon();
select is(tests.unexpected('all', '42501'), '', 'anon: every RPC refused (42501)');
select tests.as_user(tests.id('cust'));
select is(tests.unexpected('all', '42501'), '', 'customer: every RPC refused (42501)');
select tests.as_user(tests.id('drv'));
select is(tests.unexpected('all', '42501'), '', 'driver: every RPC refused (42501)');
select tests.as_user(tests.id('adm_f'));
select is(tests.unexpected('all', '42501'), '', 'admin with a temporary PIN: every RPC refused (42501)');
select tests.as_user(tests.id('adm_off'));
select is(tests.unexpected('all', '42501'), '', 'deactivated admin: every RPC refused (42501)');
select tests.as_user(tests.id('stf_f'));
select is(tests.unexpected('all', '42501'), '', 'staff with a temporary PIN: every RPC refused (42501)');
select tests.as_user(tests.id('stf_off'));
select is(tests.unexpected('all', '42501'), '', 'deactivated staff: every RPC refused (42501)');

-- ================================================================ الفعّالون
select tests.as_user(tests.id('staff'));
select is(tests.unexpected('staff', 'ok'), '', 'active staff: dashboard and ratings work');
select is(tests.unexpected('admin', '42501'), '', 'active staff: reports and stuck notifications refused (42501)');
select tests.as_user(tests.id('admin'));
select is(tests.unexpected('all', 'ok'), '', 'active admin: every RPC works');

-- ================================================================ الكتالوج
select tests.as_postgres();
select set_eq(
  $$ select p.proname::text collate "default" from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        and has_function_privilege('authenticated', p.oid, 'execute')
        and (p.proname::text like 'report\_%' or p.proname::text like 'ratings\_%'
             or p.proname::text like 'dashboard\_%' or p.proname::text like 'stuck\_%') $$,
  $$ values ('report_summary'), ('report_daily'), ('report_orders_placed'), ('report_top_products'),
            ('report_drivers'), ('report_waste'), ('ratings_summary'), ('ratings_list'),
            ('dashboard_today'), ('stuck_notifications_count') $$,
  'the matrix covers every report_* / ratings_* / dashboard_* / stuck_* RPC (a new one must be added to it)');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'every SECURITY DEFINER function in public/private has a fixed search_path');

select * from finish();
