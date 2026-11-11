-- فحص سريع لـ place_order على مشروع التطوير (T02)
-- يعمل كله داخل معاملة تنتهي بـ ROLLBACK: لا يترك أي بيانات.
-- التشغيل: انظر docs/RUNBOOK.md (قسم "فحص place_order").
-- النجاح = آخر سطر يرجع 'SMOKE OK'. أي فشل يرمي exception برسالة SMOKE FAIL.

begin;

do $$
declare
  v_cust  uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_sec int; v_sub int; v_bld int; v_cat int;
  v_p1 uuid; v_p2 uuid;
  v_addr uuid; v_addr_other uuid;
  v_key uuid := gen_random_uuid();
  r jsonb; r2 jsonb;
  v_err text;
begin
  -- مستخدمان اختباريان (الـ trigger ينشئ profile بدور customer)
  insert into auth.users (id, phone, aud, role)
  values (v_cust,  '+9647000000001', 'authenticated', 'authenticated'),
         (v_other, '+9647000000002', 'authenticated', 'authenticated');

  insert into public.sectors (name) values ('SMOKE-sector') returning id into v_sec;
  insert into public.subsections (sector_id, name) values (v_sec, 'SMOKE-sub') returning id into v_sub;
  insert into public.buildings (subsection_id, number) values (v_sub, '1') returning id into v_bld;
  insert into public.categories (name) values ('SMOKE-cat') returning id into v_cat;

  insert into public.products (category_id, name, unit, price_iqd)
  values (v_cat, 'SMOKE طماطة', 'كيلو', 1250) returning id into v_p1;
  insert into public.products (category_id, name, unit, price_iqd)
  values (v_cat, 'SMOKE خيار', 'كيلو', 750) returning id into v_p2;
  update public.stock set qty = 10 where product_id in (v_p1, v_p2);

  insert into public.addresses (customer_id, building_id, apartment)
  values (v_cust, v_bld, '5') returning id into v_addr;
  insert into public.addresses (customer_id, building_id, apartment)
  values (v_other, v_bld, '6') returning id into v_addr_other;

  -- من هنا: نتصرف كالزبون (role authenticated + JWT sub)
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1) طلب صحيح. "price_iqd" المرسل من التطبيق يجب أن يُتجاهل.
  r := public.place_order(
         v_addr,
         jsonb_build_array(
           jsonb_build_object('product_id', v_p1, 'qty', 2, 'price_iqd', 1),
           jsonb_build_object('product_id', v_p2, 'qty', 3)),
         v_key, 'فحص');
  -- 2×1250 + 3×750 = 4750، + أجرة التوصيل الافتراضية 1000 = 5750
  if (r ->> 'total_iqd')::bigint <> 5750 or r ->> 'status' <> 'pending' then
    raise exception 'SMOKE FAIL: unexpected result %', r;
  end if;

  -- 2) نفس مفتاح idempotency يرجع نفس الطلب
  r2 := public.place_order(v_addr, jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 1)), v_key);
  if r2 ->> 'order_id' <> r ->> 'order_id' or (r2 ->> 'replayed')::boolean is not true then
    raise exception 'SMOKE FAIL: idempotency replay %', r2;
  end if;

  -- 3) عنوان زبون آخر مرفوض
  begin
    perform public.place_order(v_addr_other, jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 1)), gen_random_uuid());
    raise exception 'SMOKE FAIL: foreign address accepted';
  exception when others then
    v_err := sqlerrm;
    if v_err <> 'ADDRESS_NOT_FOUND' then raise; end if;
  end;

  -- 4) كمية أكبر من المخزون (بقي 8) مرفوضة
  begin
    perform public.place_order(v_addr, jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 9)), gen_random_uuid());
    raise exception 'SMOKE FAIL: oversell accepted';
  exception when others then
    v_err := sqlerrm;
    if v_err <> 'INSUFFICIENT_STOCK' then raise; end if;
  end;

  -- 5) الزبون لا يقرأ سعر الشراء أو المخزون (RLS)
  if exists (select 1 from public.stock) or exists (select 1 from public.product_costs) then
    raise exception 'SMOKE FAIL: customer can read stock/product_costs';
  end if;

  execute 'reset role';

  -- 6) المخزون نقص فعلاً
  if (select qty from public.stock where product_id = v_p1) <> 8
     or (select qty from public.stock where product_id = v_p2) <> 7 then
    raise exception 'SMOKE FAIL: stock not decremented';
  end if;
end $$;

select 'SMOKE OK' as result;

rollback;
