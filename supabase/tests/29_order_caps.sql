-- 29: حدود الطلب (T23 H2، migration 20261130000001): max_line_qty (افتراضي 20 وحدة بيع لكل منتج = 10 كيلو
--   للنص كيلو) وmax_order_lines (افتراضي 30 منتجاً)، تفرضها place_order وتُعدَّل بـ update_app_settings (مُدقَّقة).
select plan(22);

-- رسالة:تفصيل الخطأ ('OK' عند النجاح)
create function tests.err_detail(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || ':' || coalesce(v_detail, '');
end $$;
grant execute on function tests.err_detail(text) to authenticated;

-- ================================================================ القيم الافتراضية والقيود
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'app_settings' and column_name = 'max_line_qty'),
          '20', 'max_line_qty defaults to 20 (10 kg of half-kilo units)');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'app_settings' and column_name = 'max_order_lines'),
          '30', 'max_order_lines defaults to 30');
select throws_ok($$ update public.app_settings set max_line_qty = 0 $$, '23514', null, 'max_line_qty >= 1 (CHECK)');
select throws_ok($$ update public.app_settings set max_order_lines = 51 $$, '23514', null, 'max_order_lines <= 50 (CHECK)');

-- الحدود الحقيقية (helpers ترفعهما للتجهيز)
update public.app_settings set max_line_qty = 20, max_order_lines = 30;

select tests.remember('cust', tests.new_user('customer'));
select tests.remember('addr', tests.new_address(tests.id('cust')));
select tests.remember('p1', tests.new_product(500, 1000));
create temp table caps_products on commit drop as
  select tests.new_product(250, 100) as id from generate_series(1, 31);
grant select on caps_products to authenticated;

create function tests.order_sql(p_items jsonb) returns text language sql as $$
  select format('select public.place_order(%L, %L::jsonb, %L)', tests.id('addr'), p_items, gen_random_uuid())
$$;
create function tests.lines(p_n int, p_qty int default 1) returns jsonb language sql as $$
  select jsonb_agg(tests.item(id, p_qty)) from (select id from caps_products order by id limit p_n) t
$$;
grant execute on function tests.order_sql(jsonb), tests.lines(int, int) to authenticated;

-- ================================================================ الكمية لكل منتج
select tests.as_user_aal1(tests.id('cust'));
select is(tests.err_detail(tests.order_sql(jsonb_build_array(tests.item(tests.id('p1'), 20)))), 'OK',
  '20 units (10 kg) of one product: accepted');
select is(tests.err_detail(tests.order_sql(jsonb_build_array(tests.item(tests.id('p1'), 21)))), 'QTY_LIMIT:20',
  '21 units: QTY_LIMIT, detail = the limit');
select is(tests.err_detail(tests.order_sql(jsonb_build_array(tests.item(tests.id('p1'), 15), tests.item(tests.id('p1'), 6)))),
  'QTY_LIMIT:20', 'duplicates are merged before the limit (15 + 6)');
select is(tests.err_detail(tests.order_sql(jsonb_build_array(tests.item(tests.id('p1'), 100)))), 'INVALID_QTY:',
  'more than 99 in one element is still INVALID_QTY');

-- ================================================================ عدد المنتجات
select is(tests.err_detail(tests.order_sql(tests.lines(30))), 'OK', '30 products: accepted');
select is(tests.err_detail(tests.order_sql(tests.lines(31))), 'TOO_MANY_ITEMS:30',
  '31 products: TOO_MANY_ITEMS, detail = the limit');
select is(tests.err_detail(tests.order_sql(tests.lines(30) || tests.lines(30))), 'TOO_MANY_ITEMS:30',
  'more than 50 raw elements: TOO_MANY_ITEMS before any cast');
select is(tests.err_detail(tests.order_sql(tests.lines(25) || tests.lines(25))), 'OK',
  '50 elements that merge into 25 products (qty 2 each): accepted');

-- ================================================================ الأدمن يعدّل الحدود
select tests.as_postgres();
select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.as_user(tests.id('staff'));
select throws_ok($$ select public.update_app_settings('{"max_line_qty": 10}') $$, '42501', 'NOT_ALLOWED',
  'staff cannot change the caps');
select tests.as_user(tests.id('admin'));
select is(tests.err_detail($$ select public.update_app_settings('{"max_line_qty": 0}') $$), 'INVALID_SETTINGS:max_line_qty', 'max_line_qty 0 refused');
select is(tests.err_detail($$ select public.update_app_settings('{"max_line_qty": 100}') $$), 'INVALID_SETTINGS:max_line_qty', 'max_line_qty 100 refused');
select is(tests.err_detail($$ select public.update_app_settings('{"max_line_qty": 2.5}') $$), 'INVALID_SETTINGS:max_line_qty', 'max_line_qty must be an integer');
select is(tests.err_detail($$ select public.update_app_settings('{"max_order_lines": "10"}') $$), 'INVALID_SETTINGS:max_order_lines', 'max_order_lines must be a number');
select is(tests.err_detail($$ select public.update_app_settings('{"max_order_lines": 51}') $$), 'INVALID_SETTINGS:max_order_lines', 'max_order_lines 51 refused');
select is(tests.err_detail($$ select public.update_app_settings('{"max_line_qty": 10, "max_order_lines": 5}') $$), 'OK',
  'admin sets max_line_qty 10 and max_order_lines 5');
select tests.as_postgres();
select results_eq(
  $$ select before, after from public.admin_audit where action = 'settings' order by id desc limit 1 $$,
  $$ values ('{"max_line_qty": 20, "max_order_lines": 30}'::jsonb, '{"max_line_qty": 10, "max_order_lines": 5}'::jsonb) $$,
  'the cap change is audited (old -> new)');

select tests.as_user_aal1(tests.id('cust'));
select is(tests.err_detail(tests.order_sql(jsonb_build_array(tests.item(tests.id('p1'), 11)))), 'QTY_LIMIT:10',
  'the new line cap applies at once');
select is(tests.err_detail(tests.order_sql(tests.lines(6))), 'TOO_MANY_ITEMS:5',
  'the new product-count cap applies at once');

select * from finish();
