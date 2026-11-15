-- 06: المخزون (adjust_stock، in_stock، الحماية من الكتابة المباشرة)
select plan(25);

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('cust', tests.new_user('customer'));
select tests.remember('p', tests.new_product(1000, 0, true, 300));

-- ---------------------------------------------------------------- adjust_stock (admin)
select tests.as_user(tests.id('admin'));
select is(public.adjust_stock(tests.id('p'), 10, 'purchase', 'first batch', 250), 10, 'purchase +10 -> 10');
select is((select in_stock from public.products where id = tests.id('p')), true, 'in_stock becomes true');
select is(public.adjust_stock(tests.id('p'), -3, 'waste'), 7, 'waste -3 -> 7');
select is(public.adjust_stock(tests.id('p'), -2, 'adjust', 'count'), 5, 'adjust -2 -> 5');
select is(public.adjust_stock(tests.id('p'), 1, 'adjust', 'count'), 6, 'adjust +1 -> 6');
select throws_ok(format($$ select public.adjust_stock(%L, -1, 'purchase') $$, tests.id('p')),
  'INVALID_MOVEMENT', 'negative purchase is rejected');
select throws_ok(format($$ select public.adjust_stock(%L, 1, 'waste') $$, tests.id('p')),
  'INVALID_MOVEMENT', 'positive waste is rejected');
select throws_ok(format($$ select public.adjust_stock(%L, 0, 'adjust', 'n') $$, tests.id('p')),
  'INVALID_MOVEMENT', 'zero qty is rejected');
select throws_ok(format($$ select public.adjust_stock(%L, -1, 'sale') $$, tests.id('p')),
  'INVALID_MOVEMENT', 'type sale is reserved for orders');
select throws_ok(format($$ select public.adjust_stock(%L, 1, 'cancel_return') $$, tests.id('p')),
  'INVALID_MOVEMENT', 'type cancel_return is reserved for cancellations');
select throws_ok(format($$ select public.adjust_stock(%L, -7, 'waste') $$, tests.id('p')),
  'INSUFFICIENT_STOCK', 'stock cannot go negative');
select throws_ok($$ select public.adjust_stock(gen_random_uuid(), 1, 'purchase', null, 250) $$,
  'PRODUCT_NOT_FOUND', 'unknown product');
select is(public.adjust_stock(tests.id('p'), -6, 'waste'), 0, 'waste down to 0');
select is((select in_stock from public.products where id = tests.id('p')), false, 'in_stock becomes false at 0');
select results_eq($$ select qty, type::text from public.inventory_movements
                     where product_id = tests.id('p') and created_by = (select auth.uid()) order by id $$,
  $$ values (10, 'purchase'), (-3, 'waste'), (-2, 'adjust'), (1, 'adjust'), (-6, 'waste') $$,
  'every adjustment is in the ledger, attributed to the admin');
select throws_ok(format($$ update public.stock set qty = 99 where product_id = %L $$, tests.id('p')),
  '42501', null, 'even admin cannot update stock directly');
select throws_ok(format($$ insert into public.inventory_movements (product_id, qty, type) values (%L, 5, 'purchase') $$,
  tests.id('p')), '42501', null, 'even admin cannot write the ledger directly');

-- ---------------------------------------------------------------- staff / customer
select tests.as_user(tests.id('staff'));
select throws_ok(format($$ select public.adjust_stock(%L, 1, 'purchase') $$, tests.id('p')),
  'NOT_ALLOWED', 'staff cannot adjust stock');
select isnt_empty($$ select 1 from public.stock where product_id = tests.id('p') $$, 'staff reads stock');
select is_empty($$ select 1 from public.inventory_movements $$, 'staff cannot read the ledger');
select tests.as_user(tests.id('cust'));
select throws_ok(format($$ select public.adjust_stock(%L, 1, 'purchase') $$, tests.id('p')),
  'NOT_ALLOWED', 'customer cannot adjust stock');

-- ---------------------------------------------------------------- البيع حتى النفاد ثم الإلغاء
select tests.as_postgres();
select tests.remember('q', tests.new_product(500, 2));
select tests.remember('o', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('q'), 2))));
select is((select in_stock from public.products where id = tests.id('q')), false, 'selling the last units sets in_stock = false');
select tests.as_user(tests.id('cust'));
select isnt_empty($$ select 1 from public.products where id = tests.id('q') and not in_stock $$,
  'sold-out product stays visible to customers as unavailable');
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled') $$, tests.id('o')), 'customer cancels');
select is((select in_stock from public.products where id = tests.id('q')), true, 'cancel restores stock and in_stock');

select * from finish();
