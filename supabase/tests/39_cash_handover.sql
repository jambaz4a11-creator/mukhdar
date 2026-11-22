-- 39: تسليم الكاش (T40، SPEC-cash §2، §3 K1–K19، §9.1). migration 20261212000001.
--   كل كتابة بالدور الحقيقي: موظف/أدمن aal2 (tests.as_user)، aal1 للرفض، سائق، زبون، anon.
--   دور postgres للتجهيز وللتحقق من الصفوف فقط. البيانات الموجودة (seed، dev) لا تؤثر: كل فحص مقيّد
--   بسواق هذا الملف، والفحوص العامة (الثابت) تصح على أي بيانات.
select plan(130);

-- ================================================================ مساعدات (postgres)
-- الرسالة + detail (لقراءة CASH_BALANCE_CHANGED)، أو 'OK'
create function tests.err(p_sql text) returns text language plpgsql as $$
declare m text; d text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return m || coalesce(' ' || nullif(d, ''), '');
end $$;

-- record_cash_handover كنص (للأخطاء) وكـ jsonb (للنتيجة)
create function tests.rec(p_driver uuid, p_expected bigint, p_count int, p_received bigint, p_note text, p_key uuid)
returns text language sql as $$
  select tests.err(format('select public.record_cash_handover(%L, %s, %s, %s, %L, %L)',
                          p_driver, coalesce(p_expected::text, 'null'), coalesce(p_count::text, 'null'),
                          coalesce(p_received::text, 'null'), p_note, p_key))
$$;
create function tests.rec_json(p_driver uuid, p_expected bigint, p_count int, p_received bigint, p_note text, p_key uuid)
returns jsonb language sql as $$
  select public.record_cash_handover(p_driver, p_expected, p_count, p_received, p_note, p_key)
$$;
-- رصيد سائق من cash_outstanding (بدور الجلسة الحالي)
create function tests.bal(p_driver uuid) returns text language sql as $$
  select coalesce((select c.outstanding_iqd || '/' || c.order_count from public.cash_outstanding() c
                    where c.driver_id = p_driver), 'absent')
$$;
create function tests.key(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ================================================================ التجهيز (postgres)
-- أجرة 1000 وصنف بـ 1000: كل طلب subtotal 1000 + أجرة 1000 = 2000
update public.app_settings set delivery_fee_iqd = 1000, cash_handover_includes_delivery_fee = true where id = 1;
select tests.remember('admin', tests.new_user('admin', 'مدير الكاش'));
select tests.remember('staff', tests.new_user('staff', 'علي حسن'));
select tests.remember('drv',   tests.new_user('driver', 'سائق الكاش'));
select tests.remember('drv2',  tests.new_user('driver', 'سائق ثاني'));
select tests.remember('drv3',  tests.new_user('driver', 'سائق بلا كاش'));
select tests.remember('cust',  tests.new_user('customer'));
select tests.remember('o1',    tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('o2',    tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.remember('o_way', tests.order_in('out_for_delivery', tests.id('cust'), tests.id('drv')));
select tests.remember('o_can', tests.order_in('cancelled', tests.id('cust'), tests.id('drv')));
select tests.remember('o_pen', tests.order_in('pending', tests.id('cust')));
select tests.remember('o_d2',  tests.order_in('delivered', tests.id('cust'), tests.id('drv2')));

-- ================================================================ المخطط والصلاحيات
select has_table('public', 'cash_handovers', 'cash_handovers exists');
select ok((select relrowsecurity from pg_class where oid = 'public.cash_handovers'::regclass), 'cash_handovers: RLS on');
select ok(not has_table_privilege('anon', 'public.cash_handovers', 'select, insert, update, delete')
          and not has_table_privilege('authenticated', 'public.cash_handovers', 'select, insert, update, delete')
          and not has_table_privilege('service_role', 'public.cash_handovers', 'select, insert, update, delete'),
  'cash_handovers: no table privilege for anon, authenticated or service_role');
select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('public.cash_outstanding()'::regprocedure, 'public.cash_outstanding_orders(uuid)'::regprocedure,
                    'public.record_cash_handover(uuid, bigint, integer, bigint, text, uuid)'::regprocedure,
                    'public.cash_handover_history(uuid, date, date, integer, timestamptz, uuid)'::regprocedure,
                    'public.driver_cash_summary()'::regprocedure,
                    'public.my_cash_handovers(integer, timestamptz, uuid)'::regprocedure,
                    'public.correct_cash_handover(uuid, bigint, text, bigint)'::regprocedure,
                    'public.report_cash(date, date)'::regprocedure)
      and p.prosecdef and p.proconfig = array['search_path=""']
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')),
  8, 'the 8 cash RPCs: SECURITY DEFINER, search_path pinned, authenticated only');
select ok(not has_column_privilege('authenticated', 'public.orders', 'cash_handover_id', 'update'),
  'orders.cash_handover_id is not writable by authenticated');
select tests.as_user(tests.id('admin'));
select throws_ok($$ select * from public.cash_handovers $$, '42501', null, 'admin (aal2): no direct read of cash_handovers');
select tests.as_user(tests.id('staff'));
select throws_ok($$ select * from public.cash_handovers $$, '42501', null, 'staff (aal2): no direct read of cash_handovers');
select tests.as_user_aal1(tests.id('drv'));
select throws_ok($$ select * from public.cash_handovers $$, '42501', null, 'driver: no direct read of cash_handovers');

-- ================================================================ الرصيد (K4، K5) كموظف
select tests.as_user(tests.id('staff'));
select is(tests.bal(tests.id('drv')), '4000/2',
  'K4: balance = Σ total of delivered unlinked orders only (not on-the-way, not cancelled, not another driver)');
select is(tests.bal(tests.id('drv2')), '2000/1', 'K4: the other driver has their own balance');
select is(tests.bal(tests.id('drv3')), '0/0', 'K4: an active driver with nothing to hand over is listed with 0');
select ok((select includes_delivery_fee and oldest_delivered_at is not null and last_handover_at is null
             from public.cash_outstanding() where driver_id = tests.id('drv')),
  'K4: current fee setting, oldest delivery, no handover yet');
select is((select array_agg(order_id order by order_id) from public.cash_outstanding_orders(tests.id('drv'))),
  (select array_agg(id order by id) from unnest(array[tests.id('o1'), tests.id('o2')]) id),
  'K5: the driver''s delivered unlinked orders');
select ok((select bool_and(amount_iqd = 2000 and total_iqd = 2000 and subtotal_iqd = 1000 and delivery_fee_iqd = 1000
                           and subsection = 'A1' and building = '12')
             from public.cash_outstanding_orders(tests.id('drv'))),
  'K5: amounts per order, block and building only');
select is((select count(*)::int from public.cash_outstanding_orders(tests.id('drv')) r, jsonb_object_keys(to_jsonb(r)) k
            where k ~ '(customer|phone|floor|apartment|name)'),
  0, 'K5: no customer name, phone, floor or apartment');

-- ================================================================ التحقق (K6) كموظف
select is(tests.rec(tests.id('drv'), 4000, 2, 3900, 'x', tests.key(901)), 'CASH_AMOUNT_INVALID', 'received not a multiple of 250');
select is(tests.rec(tests.id('drv'), 4000, 2, -250, 'x', tests.key(902)), 'CASH_AMOUNT_INVALID', 'negative received');
select is(tests.rec(tests.id('drv'), 4000, 2, 10004250, 'x', tests.key(903)), 'CASH_AMOUNT_INVALID', 'received above expected + 10,000,000');
select is(tests.rec(tests.id('drv'), 4000, 2, null, null, tests.key(904)), 'CASH_AMOUNT_INVALID', 'received missing');
select is(tests.rec(tests.id('drv'), 4000, 2, 3750, repeat('ن', 301), tests.key(905)), 'INVALID_REQUEST p_note', 'note over 300 characters');
select is(tests.rec(null, 4000, 2, 4000, null, tests.key(906)), 'INVALID_REQUEST p_driver_id', 'driver missing');
select is(tests.rec(tests.id('drv'), 4000, 2, 4000, null, null), 'INVALID_REQUEST p_idempotency_key', 'idempotency key missing');
select is(tests.rec(tests.id('drv'), 4000, 0, 4000, null, tests.key(907)), 'INVALID_REQUEST p_order_count', 'order count 0');
select is(tests.rec(tests.id('drv'), 3000, 2, 3000, null, tests.key(908)),
  'CASH_BALANCE_CHANGED {"order_count": 2, "expected_iqd": 4000}', 'stale expected amount: CASH_BALANCE_CHANGED with the current values');
select is(tests.rec(tests.id('drv'), 4000, 1, 4000, null, tests.key(909)),
  'CASH_BALANCE_CHANGED {"order_count": 2, "expected_iqd": 4000}', 'stale order count: CASH_BALANCE_CHANGED');
select is(tests.rec(tests.id('drv'), 4000, 2, 3750, '   ', tests.key(910)), 'NOTE_REQUIRED', 'shortage with a blank note: NOTE_REQUIRED');
select is(tests.rec(tests.id('drv'), 4000, 2, 4250, null, tests.key(911)), 'NOTE_REQUIRED', 'overage without a note: NOTE_REQUIRED');
select is(tests.rec(tests.id('drv3'), 0, 1, 0, null, tests.key(912)), 'NO_CASH_OUTSTANDING', 'nothing to hand over: NO_CASH_OUTSTANDING');
select tests.as_postgres();
select is((select count(*)::int from public.cash_handovers where driver_id in (tests.id('drv'), tests.id('drv3'))), 0,
  'refused calls wrote nothing');

-- ================================================================ تسليم مطابق كموظف aal2
select tests.as_user(tests.id('staff'));
select set_config('t.r1', tests.rec_json(tests.id('drv'), 4000, 2, 4000, null, tests.key(1))::text, true);
select ok((current_setting('t.r1')::jsonb ->> 'difference_iqd')::int = 0
          and (current_setting('t.r1')::jsonb ->> 'order_count')::int = 2
          and (current_setting('t.r1')::jsonb ->> 'replayed')::boolean = false
          and (current_setting('t.r1')::jsonb ->> 'received_iqd')::int = 4000,
  'staff records a matching handover (result: 2 orders, difference 0, not replayed)');
select tests.remember('h1', (current_setting('t.r1')::jsonb ->> 'handover_id')::uuid);
select is(tests.bal(tests.id('drv')), '0/0', 'after the handover the balance is 0');
select ok((select last_received_iqd = 4000 and last_difference_iqd = 0 and last_handover_at is not null
             from public.cash_outstanding() where driver_id = tests.id('drv')),
  'K4: last handover shown');
select tests.as_postgres();
select is((select array_agg(id order by id) from public.orders where cash_handover_id = tests.id('h1')),
  (select array_agg(id order by id) from unnest(array[tests.id('o1'), tests.id('o2')]) id),
  'exactly the two delivered orders are linked');
select is((select cash_handover_id from public.orders where id = tests.id('o_way')), null, 'the on-the-way order is not linked');
select row_eq(format($$ select kind, order_count, goods_iqd, fees_iqd, includes_delivery_fee, expected_iqd, received_iqd,
                               difference_iqd, note, recorded_by, recorded_by_role, driver_id
                          from public.cash_handovers where id = %L $$, tests.id('h1')),
  row('handover'::text, 2, 1000 * 2::bigint, 1000 * 2::bigint, true, 4000::bigint, 4000::bigint, 0::bigint,
      null::text, tests.id('staff'), 'staff'::text, tests.id('drv')),
  'the handover row: goods, fees, setting used, expected, recorder and role');
select ok((select first_delivered_at <= last_delivered_at and first_delivered_at is not null
             from public.cash_handovers where id = tests.id('h1')), 'delivered period stored');
select results_eq(format($$ select actor, after ->> 'op', (after ->> 'expected_iqd')::int, (after ->> 'received_iqd')::int,
                                   (after ->> 'difference_iqd')::int, after ->> 'driver_id'
                              from public.admin_audit where action = 'cash_handover' and target_id = %L $$, tests.id('h1')),
  format($$ values (%L::uuid, 'record'::text, 4000, 4000, 0, %L::text) $$, tests.id('staff'), tests.id('drv')),
  'audited once (op record, amounts, driver)');
select results_eq(format($$ select audience, title, body, data ->> 'type', data ->> 'handover_id'
                              from public.notification_outbox where user_id = %L and data ->> 'type' = 'cash_handover' $$, tests.id('drv')),
  format($$ values ('user'::text, 'تسليم الكاش'::text, 'استلمنا منك 4,000 د.ع'::text, 'cash_handover'::text, %L::text) $$,
         tests.id('h1')),
  'the driver is notified "استلمنا منك 4,000 د.ع" (type cash_handover)');

-- ================================================================ منع التكرار
select tests.as_user(tests.id('staff'));
select set_config('t.r1b', tests.rec_json(tests.id('drv'), 4000, 2, 4000, null, tests.key(1))::text, true);
select ok((current_setting('t.r1b')::jsonb ->> 'handover_id')::uuid = tests.id('h1')
          and (current_setting('t.r1b')::jsonb ->> 'replayed')::boolean,
  'same key again: same handover, replayed = true');
select is(tests.rec(tests.id('drv2'), 2000, 1, 2000, null, tests.key(1)), 'INVALID_REQUEST idempotency_key',
  'same key for another driver: INVALID_REQUEST');
select tests.as_postgres();
select ok((select count(*) from public.cash_handovers where idempotency_key = tests.key(1)) = 1
          and (select count(*) from public.admin_audit where action = 'cash_handover' and target_id = tests.id('h1')) = 1
          and (select count(*) from public.notification_outbox where user_id = tests.id('drv') and data ->> 'type' = 'cash_handover') = 1,
  'replay: one row, one audit, one notification');

-- ================================================================ بعد التسليم: توصيل جديد، نقص، زيادة (أدمن aal2)
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o_way'), 'delivered');
select tests.as_user(tests.id('admin'));
select is(tests.bal(tests.id('drv')), '2000/1', 'a new delivery after the handover is the only balance');
select is(tests.rec(tests.id('drv'), 2000, 1, 1750, null, tests.key(2)), 'NOTE_REQUIRED', 'admin: shortage without a note');
select set_config('t.r2', tests.rec_json(tests.id('drv'), 2000, 1, 1750, 'ناقص ربع', tests.key(2))::text, true);
select tests.remember('h2', (current_setting('t.r2')::jsonb ->> 'handover_id')::uuid);
select is((current_setting('t.r2')::jsonb ->> 'difference_iqd')::int, -250, 'admin: shortage recorded (difference -250)');
select is(tests.bal(tests.id('drv')), '0/0', 'balance 0 after a shortage handover too');
select tests.as_postgres();
select is((select cash_handover_id from public.orders where id = tests.id('o_way')), tests.id('h2'),
  'the second handover links only the new order');
select is((select body from public.notification_outbox where data ->> 'handover_id' = tests.id('h2')::text),
  'استلمنا منك 1,750 د.ع · نقص 250 د.ع', 'shortage notification: amount and shortage');
select is((select recorded_by_role from public.cash_handovers where id = tests.id('h2')), 'admin', 'recorded_by_role admin');
select tests.remember('o3', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.as_user(tests.id('admin'));
select set_config('t.r3', tests.rec_json(tests.id('drv'), 2000, 1, 2500, 'زيادة من الزبون', tests.key(3))::text, true);
select tests.remember('h3', (current_setting('t.r3')::jsonb ->> 'handover_id')::uuid);
select tests.as_postgres();
select is((select body from public.notification_outbox where data ->> 'handover_id' = tests.id('h3')::text),
  'استلمنا منك 2,500 د.ع · زيادة 500 د.ع', 'overage notification: amount and overage');

-- ================================================================ إعداد الأجرة (K19)
select tests.as_user(tests.id('staff'));
select is(tests.err($$ select public.update_app_settings('{"cash_handover_includes_delivery_fee": false}') $$), 'NOT_ALLOWED',
  'staff cannot change the fee setting');
select tests.as_user(tests.id('admin'));
select is(tests.err($$ select public.update_app_settings('{"cash_handover_includes_delivery_fee": "no"}') $$),
  'INVALID_SETTINGS cash_handover_includes_delivery_fee', 'the fee setting accepts booleans only');
select lives_ok($$ select public.update_app_settings('{"cash_handover_includes_delivery_fee": false}') $$,
  'admin: delivery fee stays with the driver');
select tests.as_postgres();
select results_eq(
  format($$ select before -> 'cash_handover_includes_delivery_fee', after -> 'cash_handover_includes_delivery_fee'
              from public.admin_audit where action = 'settings' and actor = %L $$, tests.id('admin')),
  $$ values ('true'::jsonb, 'false'::jsonb) $$, 'the setting change is audited (true -> false)');
select tests.remember('o4', tests.order_in('delivered', tests.id('cust'), tests.id('drv')));
select tests.as_user(tests.id('staff'));
select is(tests.bal(tests.id('drv')), '1000/1', 'fee stays with the driver: balance = goods only');
select is((select includes_delivery_fee from public.cash_outstanding() where driver_id = tests.id('drv')), false,
  'K4 reports the current setting');
select is((select amount_iqd from public.cash_outstanding_orders(tests.id('drv'))), 1000::bigint, 'K5 amount = goods only');
select is(tests.rec(tests.id('drv'), 2000, 1, 2000, null, tests.key(4)),
  'CASH_BALANCE_CHANGED {"order_count": 1, "expected_iqd": 1000}', 'amount shown before the change: CASH_BALANCE_CHANGED');
select set_config('t.r4', tests.rec_json(tests.id('drv'), 1000, 1, 1000, null, tests.key(4))::text, true);
select tests.remember('h4', (current_setting('t.r4')::jsonb ->> 'handover_id')::uuid);
select tests.as_postgres();
select row_eq(format($$ select goods_iqd, fees_iqd, includes_delivery_fee, expected_iqd from public.cash_handovers where id = %L $$,
                     tests.id('h4')),
  row(1000::bigint, 1000::bigint, false, 1000::bigint), 'the handover stores the setting used (false) and goods-only expected');
select row_eq(format($$ select includes_delivery_fee, expected_iqd, received_iqd from public.cash_handovers where id = %L $$,
                     tests.id('h1')),
  row(true, 4000::bigint, 4000::bigint), 'an earlier handover is not recalculated by the setting change');
select throws_ok(format($$ insert into public.cash_handovers (driver_id, order_count, goods_iqd, fees_iqd, includes_delivery_fee,
                             expected_iqd, received_iqd, first_delivered_at, last_delivered_at, recorded_by_role, idempotency_key)
                           values (%L, 1, 1000, 1000, true, 1000, 1000, now(), now(), 'admin', gen_random_uuid()) $$, tests.id('drv')),
  '23514', null, 'CHECK: expected must equal goods + fee (when included)');
select tests.as_user(tests.id('admin'));
select lives_ok($$ select public.update_app_settings('{"cash_handover_includes_delivery_fee": true}') $$, 'admin: fee back to the shop');

-- ================================================================ الثابت المحاسبي
select tests.as_postgres();
select is(
  (select count(*)::int from public.cash_handovers h
    where h.order_count <> (select count(*) from public.orders o where o.cash_handover_id = h.id)
       or h.goods_iqd <> (select coalesce(sum(o.subtotal_iqd), 0) from public.orders o where o.cash_handover_id = h.id)
       or h.fees_iqd <> (select coalesce(sum(o.delivery_fee_iqd), 0) from public.orders o where o.cash_handover_id = h.id)),
  0, 'invariant: every handover''s count, goods and fees equal its linked orders (all data)');
select is(
  (select count(*)::int from public.orders o where o.cash_handover_id is not null and o.status <> 'delivered'), 0,
  'invariant: only delivered orders are linked');
select ok(
  (select sum(o.subtotal_iqd) from public.orders o where o.driver_id = tests.id('drv') and o.status = 'delivered')
  = (select sum(h.goods_iqd) from public.cash_handovers h where h.driver_id = tests.id('drv'))
    + (select coalesce(sum(o.subtotal_iqd), 0) from public.orders o
        where o.driver_id = tests.id('drv') and o.status = 'delivered' and o.cash_handover_id is null),
  'invariant per driver: Σ goods delivered = Σ handover goods + balance goods');

-- ================================================================ القيود
select tests.as_user(tests.id('admin'));
select throws_ok(format($$ update public.orders set cash_handover_id = null where id = %L $$, tests.id('o1')), '42501', null,
  'admin cannot unlink an order directly');
select tests.as_postgres();
select throws_ok(format($$ update public.orders set cash_handover_id = %L where id = %L $$, tests.id('h1'), tests.id('o_pen')),
  '23514', null, 'CHECK: a non-delivered order cannot be linked (even as postgres)');
select throws_ok(format($$ delete from public.cash_handovers where id = %L $$, tests.id('h1')), '23503', null,
  'a handover with orders cannot be deleted (restrict)');

-- ================================================================ التقرير (K13) قبل التصحيح
-- حد اليوم ببغداد: تسليمان لسائق آخر قبل منتصف الليل بنصف ساعة وبعده بنصف ساعة
select tests.remember('drvB', tests.new_user('driver', 'سائق الحد'));
insert into public.cash_handovers (driver_id, order_count, goods_iqd, fees_iqd, includes_delivery_fee, expected_iqd, received_iqd,
                                   first_delivered_at, last_delivered_at, recorded_by_role, recorded_at, idempotency_key)
values (tests.id('drvB'), 1, 1000, 1000, true, 2000, 2000, now(), now(), 'admin',
        private.baghdad_start(public.baghdad_today()) - interval '30 minutes', gen_random_uuid()),
       (tests.id('drvB'), 1, 1000, 1000, true, 2000, 2000, now(), now(), 'admin',
        private.baghdad_start(public.baghdad_today()) + interval '30 minutes', gen_random_uuid());
-- رصيد افتتاحي (لا يظهر بالتقارير ولا بالسجل)
insert into public.cash_handovers (driver_id, kind, order_count, goods_iqd, fees_iqd, includes_delivery_fee, expected_iqd,
                                   received_iqd, first_delivered_at, last_delivered_at, idempotency_key)
values (tests.id('drv3'), 'opening', 3, 3000, 3000, true, 6000, 6000, now(), now(), gen_random_uuid())
returning tests.remember('h_open', id);
select tests.as_user(tests.id('admin'));
select set_config('t.rep', public.report_cash(public.baghdad_today() - 30, public.baghdad_today())::text, true);
select is(
  (select d - 'full_name' - 'driver_id' from jsonb_array_elements(current_setting('t.rep')::jsonb -> 'drivers') d
    where d ->> 'driver_id' = tests.id('drv')::text),
  '{"handover_count": 4, "expected_iqd": 9000, "received_iqd": 9250, "shortage_iqd": 250, "overage_iqd": 500,
    "net_difference_iqd": 250, "held_now_iqd": 0}'::jsonb,
  'report_cash per driver: shortage and overage separate, net, held now');
select ok((current_setting('t.rep')::jsonb -> 'totals' ->> 'shortage_iqd')::int >= 250
          and (current_setting('t.rep')::jsonb -> 'totals' ->> 'overage_iqd')::int >= 500,
  'report_cash totals include the shortage and the overage separately');
select is(
  (select count(*)::int from jsonb_array_elements(current_setting('t.rep')::jsonb -> 'drivers') d
    where d ->> 'driver_id' = tests.id('drv3')::text),
  0, 'report_cash: the opening balance is excluded');
select is(
  (select (d ->> 'held_now_iqd')::int || '/' || (d ->> 'handover_count')
     from jsonb_array_elements(current_setting('t.rep')::jsonb -> 'drivers') d where d ->> 'driver_id' = tests.id('drv2')::text),
  '2000/0', 'report_cash: a driver with no handover but a balance shows held_now only');
select is((current_setting('t.rep')::jsonb ->> 'held_now_iqd')::bigint,
  (select sum(outstanding_iqd)::bigint from public.cash_outstanding()), 'held_now_iqd = Σ balances');
select is(
  (select (d ->> 'handover_count')::int from jsonb_array_elements(public.report_cash(public.baghdad_today(), public.baghdad_today()) -> 'drivers') d
    where d ->> 'driver_id' = tests.id('drvB')::text),
  1, 'report_cash: 00:30 Baghdad counts today');
select is(
  (select (d ->> 'handover_count')::int from jsonb_array_elements(public.report_cash(public.baghdad_today() - 1, public.baghdad_today() - 1) -> 'drivers') d
    where d ->> 'driver_id' = tests.id('drvB')::text),
  1, 'report_cash: 23:30 Baghdad counts yesterday');
select is(tests.err($$ select public.report_cash(current_date, current_date - 1) $$), 'INVALID_DATE_RANGE', 'report_cash: bad range');
select is(tests.err($$ select public.report_cash(current_date - 400, current_date) $$), 'INVALID_DATE_RANGE', 'report_cash: > 366 days');

-- ================================================================ التصحيح (K12)
select tests.as_user(tests.id('staff'));
select is(tests.err(format($$ select public.correct_cash_handover(%L, 2000, 'x') $$, tests.id('h2'))), 'NOT_ALLOWED',
  'staff cannot correct');
select tests.as_user(tests.id('admin'));
select is(tests.err(format($$ select public.correct_cash_handover(%L, 2000, null) $$, tests.id('h2'))), 'NOTE_REQUIRED',
  'correction needs a note');
select is(tests.err(format($$ select public.correct_cash_handover(%L, 2100, 'x') $$, tests.id('h2'))), 'CASH_AMOUNT_INVALID',
  'correction: amount must be a multiple of 250');
select is(tests.err(format($$ select public.correct_cash_handover(%L, 2000, 'x') $$, tests.id('h_open'))), 'HANDOVER_NOT_FOUND',
  'opening balance cannot be corrected');
select is(tests.err(format($$ select public.correct_cash_handover(%L, 2000, 'x') $$, gen_random_uuid())), 'HANDOVER_NOT_FOUND',
  'unknown handover');
select lives_ok(format($$ select public.correct_cash_handover(%L, 2000, 'عدّيتها غلط') $$, tests.id('h2')), 'admin corrects');
select lives_ok(format($$ select public.correct_cash_handover(%L, 1500, 'تصحيح ثاني') $$, tests.id('h2')), 'admin corrects again');
select tests.as_postgres();
select row_eq(format($$ select received_iqd, difference_iqd, original_received_iqd, corrected_by, note
                          from public.cash_handovers where id = %L $$, tests.id('h2')),
  row(1500::bigint, -500::bigint, 1750::bigint, tests.id('admin'), 'تصحيح ثاني'::text),
  'corrected: amount and difference change; original amount kept from the first correction');
select results_eq(format($$ select (before ->> 'received_iqd')::int, (after ->> 'received_iqd')::int, after ->> 'op'
                              from public.admin_audit where action = 'cash_handover' and target_id = %L and after ->> 'op' = 'correct'
                             order by id $$, tests.id('h2')),
  $$ values (1750, 2000, 'correct'::text), (2000, 1500, 'correct'::text) $$, 'each correction audited (before -> after)');
select is((select count(*)::int from public.notification_outbox
            where data ->> 'handover_id' = tests.id('h2')::text and body like 'تعدّل تسليم الكاش: %'), 2,
  'the driver is notified of each correction');
select is((select count(*)::int from public.orders where cash_handover_id = tests.id('h2')), 1,
  'correction does not touch the linked orders');

-- ================================================================ السجل (K7)
update public.cash_handovers set recorded_at = now() - interval '10 days' where id = tests.id('h3');
select tests.as_user(tests.id('staff'));
select is((select count(*)::int from public.cash_handover_history(tests.id('drv')) where id = tests.id('h3')), 0,
  'staff: a handover older than 7 days (Baghdad) is hidden');
select is((select count(*)::int from public.cash_handover_history(tests.id('drv'))), 3, 'staff: the recent three are listed');
select is((select original_received_iqd from public.cash_handover_history(tests.id('drv')) where id = tests.id('h2')), null,
  'staff: original amount of a correction is admin-only');
select is((select recorded_by_name from public.cash_handover_history(tests.id('drv')) where id = tests.id('h1')), 'علي حسن',
  'history shows the recorder''s name');
select tests.as_user(tests.id('admin'));
select is((select count(*)::int from public.cash_handover_history(tests.id('drv'))), 4, 'admin: sees the old one too');
select is((select original_received_iqd from public.cash_handover_history(tests.id('drv')) where id = tests.id('h2')), 1750::bigint,
  'admin: sees the original amount');
select is((select count(*)::int from public.cash_handover_history(tests.id('drv3'))), 0, 'history: opening excluded');
select is((select count(*)::int from public.cash_handover_history(tests.id('drv'), public.baghdad_today(), public.baghdad_today())), 3,
  'history: date filter (Baghdad day of recorded_at)');
-- keyset: صفحتان من 2 = الكل بلا تكرار
select set_config('t.page1', (select json_agg(json_build_object('id', id, 'at', recorded_at))::text
                                from public.cash_handover_history(tests.id('drv'), null, null, 2)), true);
select is(
  (select array_agg(x order by x) from (
     select (e ->> 'id')::uuid x from json_array_elements(current_setting('t.page1')::json) e
     union all
     select id from public.cash_handover_history(tests.id('drv'), null, null, 2,
                    (current_setting('t.page1')::json -> 1 ->> 'at')::timestamptz,
                    (current_setting('t.page1')::json -> 1 ->> 'id')::uuid)) s),
  (select array_agg(id order by id) from public.cash_handover_history(tests.id('drv'))),
  'history keyset: two pages of 2 cover all 4 with no duplicate');
select is(tests.err($$ select * from public.cash_handover_history(null, current_date, current_date - 1) $$), 'INVALID_DATE_RANGE',
  'history: bad range');

-- ================================================================ دوال السائق (K10، K11)
select tests.as_user_aal1(tests.id('drv3'));
select row_eq($$ select outstanding_iqd, order_count, oldest_delivered_at, last_handover_at, last_received_iqd, last_difference_iqd,
                        includes_delivery_fee from public.driver_cash_summary() $$,
  row(0::bigint, 0, null::timestamptz, null::timestamptz, null::bigint, null::bigint, true),
  'driver_cash_summary: one row of zeros without data (opening excluded)');
select tests.as_user_aal1(tests.id('drv2'));
select is((select outstanding_iqd || '/' || order_count from public.driver_cash_summary()), '2000/1',
  'driver_cash_summary: the own balance');
select is((select count(*)::int from public.my_cash_handovers()), 0, 'my_cash_handovers: another driver''s handovers are not listed');
select tests.as_user_aal1(tests.id('drv'));
select ok((select outstanding_iqd = 0 and last_received_iqd is not null and last_handover_at is not null from public.driver_cash_summary()),
  'driver_cash_summary: balance 0 and the last handover after handing over');
select is((select count(*)::int from public.my_cash_handovers()), 4, 'my_cash_handovers: own four handovers');
select is((select recorded_by_name from public.my_cash_handovers() where id = tests.id('h1')), 'علي',
  'my_cash_handovers: recorder first name only');
select ok((select corrected_at is not null and difference_iqd = -500 and note = 'تصحيح ثاني'
             from public.my_cash_handovers() where id = tests.id('h2')),
  'my_cash_handovers: shows the correction and the note');
select is((select count(*)::int from public.my_cash_handovers(2)), 2, 'my_cash_handovers: limit');

-- ================================================================ الأدوار
select tests.as_user_aal1(tests.id('admin'));
select is(tests.rec(tests.id('drv2'), 2000, 1, 2000, null, tests.key(20)), 'NOT_ALLOWED', 'admin aal1: record refused');
select is(tests.err($$ select * from public.cash_outstanding() $$), 'NOT_ALLOWED', 'admin aal1: balances refused');
select tests.as_user_aal1(tests.id('staff'));
select is(tests.rec(tests.id('drv2'), 2000, 1, 2000, null, tests.key(21)), 'NOT_ALLOWED', 'staff aal1: record refused');
select tests.as_user(tests.id('staff'));
select is(tests.err($$ select public.report_cash(current_date - 7, current_date) $$), 'NOT_ALLOWED', 'staff: report_cash refused');
select is(tests.err($$ select * from public.driver_cash_summary() $$), 'NOT_ALLOWED', 'staff: driver_cash_summary refused');
select tests.as_user_aal1(tests.id('drv'));
select is(tests.rec(tests.id('drv'), 0, 1, 0, null, tests.key(22)), 'NOT_ALLOWED', 'driver: cannot record a handover');
select is(tests.err($$ select * from public.cash_outstanding() $$), 'NOT_ALLOWED', 'driver: balances refused');
select is(tests.err(format($$ select * from public.cash_outstanding_orders(%L) $$, tests.id('drv'))), 'NOT_ALLOWED',
  'driver: outstanding orders refused');
select is(tests.err($$ select * from public.cash_handover_history() $$), 'NOT_ALLOWED', 'driver: history refused');
select tests.as_user_aal1(tests.id('cust'));
select is(tests.err($$ select * from public.my_cash_handovers() $$), 'NOT_ALLOWED', 'customer: my_cash_handovers refused');
select is(tests.err($$ select * from public.cash_outstanding() $$), 'NOT_ALLOWED', 'customer: balances refused');
select tests.as_postgres();
update public.profiles set must_change_pin = true where id = tests.id('drv2');
select tests.as_user_aal1(tests.id('drv2'));
select is(tests.err($$ select * from public.driver_cash_summary() $$), 'NOT_ALLOWED', 'driver with a temporary PIN: refused');
select tests.as_postgres();
update public.profiles set must_change_pin = false, is_active = false where id = tests.id('drv2');
select tests.as_user_aal1(tests.id('drv2'));
select is(tests.err($$ select * from public.my_cash_handovers() $$), 'NOT_ALLOWED', 'deactivated driver: refused');
select tests.as_anon();
select throws_ok($$ select * from public.cash_outstanding() $$, '42501', null, 'anon: no execute');
select throws_ok($$ select * from public.driver_cash_summary() $$, '42501', null, 'anon: no execute (driver summary)');

-- ================================================================ K4: معطّل/مخفَّض برصيد يبقى ظاهراً
select tests.as_postgres();
select tests.remember('drv_dem', tests.new_user('driver', 'سائق مخفَّض'));
select tests.remember('drv_off0', tests.new_user('driver', 'سائق معطّل بلا كاش'));
select tests.order_in('delivered', tests.id('cust'), tests.id('drv_dem'));
update public.profiles set role = 'customer' where id = tests.id('drv_dem');
update public.profiles set is_active = false where id = tests.id('drv_off0');
select tests.as_user(tests.id('staff'));
select is(tests.bal(tests.id('drv2')), '2000/1', 'K4: a deactivated driver holding cash is still listed');
select ok((select not is_active from public.cash_outstanding() where driver_id = tests.id('drv2')), 'K4: flagged inactive');
select is(tests.bal(tests.id('drv_dem')), '2000/1', 'K4: a demoted account holding cash is still listed');
select is(tests.bal(tests.id('drv_off0')), 'absent', 'K4: an inactive driver with no cash is not listed');
select is((select array_agg(outstanding_iqd) from public.cash_outstanding()),
  (select array_agg(outstanding_iqd order by outstanding_iqd desc) from public.cash_outstanding()),
  'K4: ordered by balance, highest first');
-- التسليم من موظف لسائق معطّل مسموح (الرصيد يُغلق)
select is(tests.rec(tests.id('drv2'), 2000, 1, 2000, null, tests.key(30)), 'OK', 'staff can take cash from a deactivated driver');

-- ================================================================ K9: حذف الحساب
select tests.as_service();
select is(tests.err(format($$ select public.begin_account_deletion(%L) $$, tests.id('drv_dem'))), 'CASH_OUTSTANDING 2000',
  'account deletion with cash outstanding: CASH_OUTSTANDING (detail = amount)');
select tests.as_user(tests.id('staff'));
select is(tests.rec(tests.id('drv_dem'), 2000, 1, 2000, null, tests.key(31)), 'OK', 'staff takes the cash');
select tests.as_service();
select is(tests.err(format($$ select public.begin_account_deletion(%L) $$, tests.id('drv_dem'))), 'OK',
  'after the handover, deletion is accepted');
select tests.as_postgres();
delete from auth.users where id = tests.id('drv_dem');
select is((select count(*)::int from public.cash_handovers where idempotency_key = tests.key(31) and driver_id is null), 1,
  'after deletion the handover stays with driver_id null');

select * from finish();
