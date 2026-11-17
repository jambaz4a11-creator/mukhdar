-- دوال مساعدة لاختبارات pgTAP.
-- لا تُطبَّق كـ migration: سكربت scripts/db-test.mjs ينشئها داخل معاملة كل ملف اختبار
-- (BEGIN ... ROLLBACK)، فلا يبقى منها شيء بقاعدة البيانات.
-- الدوال تُستدعى بدور postgres، عدا as_*، وهي متاحة لكل الأدوار للتبديل بينها.

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- الدوال الجديدة لا تُنفَّذ افتراضياً من PUBLIC (migration 20261111000002)، وامتداد pgtap
-- يُنشأ داخل المعاملة؛ فنمنح دواله للأدوار التي تُشغَّل بها التأكيدات. يُلغى مع المعاملة.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
             join pg_depend d on d.objid = p.oid and d.deptype = 'e'
             join pg_extension e on e.oid = d.refobjid and e.extname = 'pgtap'
  loop
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;

-- حد الطلبات غير المنتهية للزبون (افتراضي 3) يُرفع للتجهيز؛ 03_place_order يختبره بقيمته الحقيقية.
-- حدا الطلب (T23 H2: 20 وحدة لكل منتج، 30 منتجاً) وحد الحساب الجديد (طلب مفتوح واحد حتى أول تسليم) يُرفعان لأقصاها
-- للتجهيز؛ 29_order_caps و30_e2 يختبرانها.
update public.app_settings set max_active_orders = 1000, new_account_max_active_orders = 1000, max_line_qty = 99, max_order_lines = 50,
                               max_order_iqd = 100000000, new_account_max_order_iqd = 100000000;

create sequence tests.phone_seq start 9647900000000;

-- ---------------------------------------------------------------------
-- التبديل بين المستخدمين
-- ---------------------------------------------------------------------
-- مستخدم مسجل حقيقي: role authenticated + JWT sub (مثل طلب من التطبيق). الجلسة aal2 (دخل بالـ PIN ورمز
-- تطبيق المصادقة؛ T23 C1: الأدمن والموظف يحتاجانها، الزبون والسائق لا يتأثران). as_user_aal1 = الـ PIN وحده.
create function tests.as_user(p_uid uuid, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function tests.as_user_aal1(p_uid uuid) returns void language sql as $$
  select tests.as_user(p_uid, 'aal1')
$$;

-- T23 F H1: جلسة Auth حقيقية (aal2) لحساب أدمن/موظف: رموز إشعاراتهم تُربط بها ولا تستلم بدونها.
-- panel_session ينشئ الصف ويرجع معرّفه (من دور postgres)، as_panel يدخل بها (claims مع session_id).
create function tests.panel_session(p_uid uuid, p_aal text default 'aal2') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_sid uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (v_sid, p_uid, now(), now(), p_aal::auth.aal_level);
  return v_sid;
end $$;

create function tests.as_panel(p_uid uuid, p_sid uuid default null) returns uuid language plpgsql as $$
declare v_sid uuid := coalesce(p_sid, tests.panel_session(p_uid));
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2', 'session_id', v_sid)::text, true);
  perform set_config('role', 'authenticated', true);
  return v_sid;
end $$;

-- زائر غير مسجل
create function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

-- Edge Function (service_role، مثل push-dispatch)
create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;

-- رجوع لدور postgres (لتجهيز البيانات والتحقق بدون RLS)
create function tests.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- يضبط auth.uid() فقط بدون تغيير الدور: لاستدعاء دوال RPC من التجهيز
create function tests.set_uid(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

-- حفظ معرّفات التجهيز بإعداد جلسة محلي (يُقرأ من أي دور، ويُلغى مع المعاملة)
create function tests.remember(p_name text, p_id uuid) returns uuid language sql as $$
  select set_config('t.' || p_name, p_id::text, true)::uuid
$$;
create function tests.id(p_name text) returns uuid language sql stable as $$
  select current_setting('t.' || p_name)::uuid
$$;

-- ينفّذ SQL ويرجع 'OK' أو رسالة الخطأ (رمز مثل NOT_ALLOWED)
create function tests.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

-- ينفّذ SQL (بدور الجلسة الحالي) ويرجع عدد الصفوف المتأثرة: لاختبار RLS على update/delete
create function tests.affected(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- تجهيز البيانات
-- ---------------------------------------------------------------------
create function tests.new_user(p_role public.user_role default 'customer', p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, phone, aud, role)
  values (v_id, nextval('tests.phone_seq')::text, 'authenticated', 'authenticated');
  update public.profiles set role = p_role, full_name = coalesce(p_name, 'test ' || p_role::text)
   where id = v_id;
  return v_id;
end $$;

create function tests.new_product(
  p_price bigint, p_stock int default 100, p_active boolean default true, p_cost bigint default null)
returns uuid language plpgsql as $$
declare v_cat int; v_id uuid;
begin
  insert into public.categories (name) values ('test-cat ' || gen_random_uuid()) returning id into v_cat;
  insert into public.products (category_id, name, unit, price_iqd, is_active)
  values (v_cat, 'test-product ' || left(gen_random_uuid()::text, 8), 'نص كيلو', p_price, p_active)
  returning id into v_id;
  if p_cost is not null then
    insert into public.product_costs (product_id, cost_iqd) values (v_id, p_cost);
  end if;
  -- الرصيد الافتتاحي مع حركته بالدفتر (الثابت stock.qty = Σ الحركات، T18)
  if p_stock > 0 then
    update public.stock set qty = p_stock where product_id = v_id;
    insert into public.inventory_movements (product_id, qty, type, note)
    values (v_id, p_stock, 'adjust', 'opening (test)');
  end if;
  return v_id;
end $$;

create function tests.new_address(p_customer uuid) returns uuid language plpgsql as $$
declare v_sec int; v_sub int; v_bld int; v_id uuid;
begin
  insert into public.sectors (name) values ('test-sector ' || gen_random_uuid()) returning id into v_sec;
  insert into public.subsections (sector_id, name) values (v_sec, 'A1') returning id into v_sub;
  insert into public.buildings (subsection_id, number) values (v_sub, '12') returning id into v_bld;
  insert into public.addresses (customer_id, building_id, apartment)
  values (p_customer, v_bld, '3') returning id into v_id;
  return v_id;
end $$;

create function tests.item(p_product uuid, p_qty int) returns jsonb language sql immutable as $$
  select jsonb_build_object('product_id', p_product, 'qty', p_qty)
$$;

-- طلب جديد للزبون (بعنوان جديد إن لم يُعطَ). يرجع order_id.
create function tests.place(p_customer uuid, p_items jsonb, p_address uuid default null)
returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform tests.set_uid(p_customer);
  -- يعيد استعمال أحدث عنوان للزبون (حد 20 عنواناً لكل زبون، T23 L3) ويُنشئ واحداً إن لم يوجد
  r := public.place_order(
         coalesce(p_address,
                  (select a.id from public.addresses a where a.customer_id = p_customer
                    order by a.created_at desc, a.id limit 1),
                  tests.new_address(p_customer)),
         p_items, gen_random_uuid());
  perform set_config('request.jwt.claims', '{}', true);
  return (r ->> 'order_id')::uuid;
end $$;

-- طلب بحالة معينة، بالمسار الحقيقي (pending ← preparing ← ready ← out_for_delivery ← delivered).
-- السائق p_driver يُعيَّن بعد preparing (assign_driver مسموح من preparing أو ready)، ويُنشأ سائق
-- إن احتاجت الحالة ولم يُعطَ. 'cancelled' مع سائق: يُلغى من preparing بعد التعيين، وبدونه من pending.
create function tests.order_in(
  p_status public.order_status, p_customer uuid default null, p_driver uuid default null)
returns uuid language plpgsql as $$
declare
  v_admin  uuid := tests.new_user('admin');
  v_cust   uuid := coalesce(p_customer, tests.new_user('customer'));
  v_driver uuid := p_driver;
  v_order  uuid;
begin
  if p_status = 'pending' and p_driver is not null then
    raise exception 'order_in: a pending order cannot have a driver (assign_driver needs preparing/ready)';
  end if;
  v_order := tests.place(v_cust, jsonb_build_array(tests.item(tests.new_product(1000, 10), 1)));
  if v_driver is null and p_status in ('out_for_delivery', 'delivered') then
    v_driver := tests.new_user('driver');
  end if;

  perform tests.set_uid(v_admin);
  if p_status = 'cancelled' and v_driver is null then
    perform public.set_order_status(v_order, 'cancelled');
  elsif p_status <> 'pending' then
    perform public.set_order_status(v_order, 'preparing');
    if v_driver is not null then
      perform public.assign_driver(v_order, v_driver);
    end if;
    if p_status = 'cancelled' then
      perform public.set_order_status(v_order, 'cancelled');
    elsif p_status in ('ready', 'out_for_delivery', 'delivered') then
      perform public.set_order_status(v_order, 'ready');
      if p_status in ('out_for_delivery', 'delivered') then
        perform public.set_order_status(v_order, 'out_for_delivery');
      end if;
      if p_status = 'delivered' then
        perform public.set_order_status(v_order, 'delivered');
      end if;
    end if;
  end if;
  perform set_config('request.jwt.claims', '{}', true);
  return v_order;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
