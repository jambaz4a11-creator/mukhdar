-- 40: R4 fixes to the cash handover (docs/reviews/R4-cash-review.md, migration 20261213000001) and the review's
--   missing tests T2, T3, T5, T6, T7 (T1 and L3 are in scripts/db-concurrency.mjs 5e/5f, T4 in 27_access_matrix.sql,
--   T8 in apps/admin). Every write as the real role: staff/admin aal2 (tests.as_user), service_role for account
--   deletion; postgres only for setup and for reading rows back. Checks are limited to this file's users, so existing
--   data (seed, dev) doesn't matter.
select plan(42);

-- ================================================================ helpers (postgres)
create function tests.err(p_sql text) returns text language plpgsql as $$
declare m text; d text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return m || coalesce(' ' || nullif(d, ''), '');
end $$;
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
create function tests.fix(p_id uuid, p_received bigint, p_note text, p_expected bigint) returns text language sql as $$
  select tests.err(format('select public.correct_cash_handover(%L, %s, %L, %s)', p_id, p_received, p_note,
                          coalesce(p_expected::text, 'null')))
$$;
create function tests.fix_json(p_id uuid, p_received bigint, p_note text, p_expected bigint) returns jsonb language sql as $$
  select public.correct_cash_handover(p_id, p_received, p_note, p_expected)
$$;
create function tests.key(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0040-' || lpad(p_n::text, 12, '0'))::uuid
$$;
-- a handover row inserted directly (setup only), at a given time
create function tests.old_handover(p_driver uuid, p_at timestamptz, p_received bigint) returns uuid language sql as $$
  insert into public.cash_handovers (driver_id, order_count, goods_iqd, fees_iqd, includes_delivery_fee, expected_iqd,
                                     received_iqd, note, first_delivered_at, last_delivered_at, recorded_by_role,
                                     recorded_at, idempotency_key)
  values (p_driver, 1, 1000, 1000, true, 2000, p_received, case when p_received <> 2000 then 'x' end, p_at, p_at,
          'admin', p_at, gen_random_uuid())
  returning id
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ================================================================ setup (postgres)
-- fee 1000 and an item at 1000: each order is subtotal 1000 + fee 1000 = 2000
update public.app_settings set delivery_fee_iqd = 1000, cash_handover_includes_delivery_fee = true where id = 1;
select tests.remember('admin',  tests.new_user('admin', 'مدير أول'));
select tests.remember('admin2', tests.new_user('admin', 'مدير ثاني'));
select tests.remember('adm_tmp', tests.new_user('admin', 'مدير برمز مؤقت'));
select tests.remember('staff',  tests.new_user('staff', 'موظف الكاش'));
select tests.remember('stf_tmp', tests.new_user('staff', 'موظف برمز مؤقت'));
update public.profiles set must_change_pin = true where id in (tests.id('adm_tmp'), tests.id('stf_tmp'));
select tests.remember('cust',   tests.new_user('customer'));
select tests.remember('drv',    tests.new_user('driver', 'سائق الإعادة'));
select tests.remember('drvW',   tests.new_user('driver', 'سائق النافذة'));
select tests.remember('drvOld', tests.new_user('driver', 'سائق قديم'));
select tests.remember('drvDem', tests.new_user('driver', 'سائق مخفَّض'));
select tests.remember('drvFee', tests.new_user('driver', 'سائق الأجرة'));
select tests.remember('drvDel', tests.new_user('driver', 'سائق محذوف'));
select tests.order_in('delivered', tests.id('cust'), tests.id('drv'));
select tests.order_in('delivered', tests.id('cust'), tests.id('drvDem'));
select tests.order_in('delivered', tests.id('cust'), tests.id('drvFee'));
select tests.order_in('delivered', tests.id('cust'), tests.id('drvDel'));

-- ================================================================ L2 / T2: replay with the same key
select tests.as_user(tests.id('staff'));
select set_config('t.r1', tests.rec_json(tests.id('drv'), 2000, 1, 1750, 'ناقص ربع', tests.key(1))::text, true);
select tests.remember('h1', (current_setting('t.r1')::jsonb ->> 'handover_id')::uuid);
select ok((tests.rec_json(tests.id('drv'), 2000, 1, 1750, '  ناقص ربع ', tests.key(1)) ->> 'replayed')::boolean,
  'L2: the same request again (note differs only by spaces): replayed, no error');
select is(tests.rec(tests.id('drv'), 2000, 1, 2000, null, tests.key(1)), 'INVALID_REQUEST idempotency_key',
  'L2/T2: same key, different amount: INVALID_REQUEST idempotency_key');
select is(tests.rec(tests.id('drv'), 2000, 1, 1750, 'سبب آخر', tests.key(1)), 'INVALID_REQUEST idempotency_key',
  'L2/T2: same key and amount, different note: INVALID_REQUEST idempotency_key');
select is(tests.rec(tests.id('drv'), 4000, 2, 1750, 'ناقص ربع', tests.key(1)), 'INVALID_REQUEST idempotency_key',
  'L2: same key, different expected amount and count: INVALID_REQUEST idempotency_key');
select tests.as_postgres();
select ok((select count(*) from public.cash_handovers where idempotency_key = tests.key(1)) = 1
          and (select received_iqd from public.cash_handovers where id = tests.id('h1')) = 1750
          and (select note from public.cash_handovers where id = tests.id('h1')) = 'ناقص ربع'
          and (select count(*) from public.admin_audit where action = 'cash_handover' and target_id = tests.id('h1')) = 1
          and (select count(*) from public.notification_outbox where data ->> 'handover_id' = tests.id('h1')::text) = 1,
  'L2: one row with the first amount and note, one audit line, one notification');

-- ================================================================ L4: absurd expected amount
select tests.as_user(tests.id('staff'));
select is(tests.rec(tests.id('drv'), 9223372036854775000, 1, 0, null, tests.key(2)), 'INVALID_REQUEST p_expected_iqd',
  'L4: expected near the bigint maximum: INVALID_REQUEST p_expected_iqd (no overflow error)');
select is(tests.rec(tests.id('drv'), 1000000000250, 1, 0, null, tests.key(3)), 'INVALID_REQUEST p_expected_iqd',
  'L4: expected above 10^12: INVALID_REQUEST p_expected_iqd');

-- ================================================================ T3: admin/staff with a temporary PIN (aal2 session)
select tests.as_user(tests.id('adm_tmp'));
select is(tests.rec(tests.id('drvFee'), 2000, 1, 2000, null, tests.key(4)), 'NOT_ALLOWED',
  'T3: admin with a temporary PIN (aal2): record refused');
select is(tests.fix(tests.id('h1'), 2000, 'x', 1750), 'NOT_ALLOWED', 'T3: admin with a temporary PIN: correction refused');
select tests.as_user(tests.id('stf_tmp'));
select is(tests.rec(tests.id('drvFee'), 2000, 1, 2000, null, tests.key(5)), 'NOT_ALLOWED',
  'T3: staff with a temporary PIN (aal2): record refused');
select tests.as_postgres();
select is((select count(*)::int from public.cash_handovers where driver_id = tests.id('drvFee')), 0,
  'T3: the refused calls wrote nothing');

-- ================================================================ L6 / T7: corrections
select tests.as_user(tests.id('admin'));
select set_config('t.c0', tests.fix_json(tests.id('h1'), 1750, 'نفس المبلغ', 1750)::text, true);
select is((current_setting('t.c0')::jsonb ->> 'changed')::boolean, false, 'T7: correction with the same amount: changed false');
select tests.as_postgres();
select ok((select count(*) from public.admin_audit where target_id = tests.id('h1') and after ->> 'op' = 'correct') = 0
          and (select count(*) from public.notification_outbox
                where data ->> 'handover_id' = tests.id('h1')::text and body like 'تعدّل%') = 0
          and (select corrected_at is null and note = 'ناقص ربع' from public.cash_handovers where id = tests.id('h1')),
  'T7: same amount: no audit, no notification, row untouched');
select tests.as_user(tests.id('admin'));
select is((tests.fix_json(tests.id('h1'), 2000, 'عدّيتها غلط', 1750) ->> 'changed')::boolean, true,
  'L6: admin 1 corrects 1,750 -> 2,000 (saw 1,750)');
select tests.as_user(tests.id('admin2'));
select is(tests.fix(tests.id('h1'), 1500, 'تصحيحي', 1750), 'HANDOVER_CHANGED 2000',
  'L6: admin 2, who also saw 1,750, is refused: HANDOVER_CHANGED (detail = stored amount)');
select tests.as_user(tests.id('admin'));
select is((tests.fix_json(tests.id('h1'), 2000, 'عدّيتها غلط', 1750) ->> 'changed')::boolean, false,
  'L6: a double click on the same correction is a no-op, not HANDOVER_CHANGED');
select tests.as_postgres();
select row_eq(format($$ select received_iqd, original_received_iqd, corrected_by, note from public.cash_handovers where id = %L $$,
                     tests.id('h1')),
  row(2000::bigint, 1750::bigint, tests.id('admin'), 'عدّيتها غلط'::text),
  'L6: admin 1''s correction stands; admin 2 overwrote nothing');
select is((select count(*)::int from public.admin_audit where target_id = tests.id('h1') and after ->> 'op' = 'correct'), 1,
  'L6: one correction audited');
select tests.as_user(tests.id('admin2'));
select is((tests.fix_json(tests.id('h1'), 1500, 'بعد ما شفت المبلغ الجديد', 2000) ->> 'changed')::boolean, true,
  'L6: with the current amount, admin 2''s correction goes through');
select tests.as_user(tests.id('staff'));
select ok((tests.rec_json(tests.id('drv'), 2000, 1, 1750, 'ناقص ربع', tests.key(1)) ->> 'replayed')::boolean,
  'L2: a replay of the original request after a correction is still recognised (original amount)');

-- ================================================================ T5 + L5: staff 7-day window boundary
select tests.as_postgres();
-- drvW: today − 7 at 23:55 (hidden) and today − 6 at 00:05 (visible, Baghdad); drvOld: 10 days ago only
select tests.remember('hW_old', tests.old_handover(tests.id('drvW'),
  private.baghdad_start(public.baghdad_today() - 6) - interval '5 minutes', 2000));
select tests.remember('hW_new', tests.old_handover(tests.id('drvW'),
  private.baghdad_start(public.baghdad_today() - 6) + interval '5 minutes', 1750));
select tests.remember('hOld', tests.old_handover(tests.id('drvOld'), now() - interval '10 days', 1500));
select tests.as_user(tests.id('staff'));
select is((select array_agg(id) from public.cash_handover_history(tests.id('drvW'))), array[tests.id('hW_new')],
  'T5: staff see a handover at today − 6 00:05 Baghdad but not one at today − 7 23:55');
select tests.as_user(tests.id('admin'));
select is((select count(*)::int from public.cash_handover_history(tests.id('drvW'))), 2, 'T5: admin sees both');
select tests.as_user(tests.id('staff'));
select row_eq(format($$ select last_received_iqd, last_difference_iqd from public.cash_outstanding() where driver_id = %L $$,
                     tests.id('drvW')),
  row(1750::bigint, -250::bigint), 'L5: staff see the last handover''s amount inside the window (today − 6 00:05)');
select ok((select last_handover_at is not null and last_received_iqd is null and last_difference_iqd is null
             from public.cash_outstanding() where driver_id = tests.id('drvOld')),
  'L5: staff don''t see the amount of a last handover older than 7 days (the time stays)');
select tests.as_user(tests.id('admin'));
select row_eq(format($$ select last_received_iqd, last_difference_iqd from public.cash_outstanding() where driver_id = %L $$,
                     tests.id('drvOld')),
  row(1500::bigint, -500::bigint), 'L5: admin still sees it');

-- ================================================================ L9: no cash notification for a demoted account
select tests.as_postgres();
update public.profiles set role = 'customer' where id = tests.id('drvDem');
select tests.as_user(tests.id('staff'));
select set_config('t.dem', tests.rec_json(tests.id('drvDem'), 2000, 1, 1500, 'ناقص', tests.key(6))::text, true);
select tests.remember('hDem', (current_setting('t.dem')::jsonb ->> 'handover_id')::uuid);
select tests.as_user(tests.id('admin'));
select lives_ok(format($$ select public.correct_cash_handover(%L, 2000, 'اكتمل', 1500) $$, tests.id('hDem')),
  'L9: the demoted account''s handover can still be corrected');
select tests.as_postgres();
select is((select count(*)::int from public.notification_outbox
            where user_id = tests.id('drvDem') and data ->> 'type' = 'cash_handover'), 0,
  'L9: an account demoted from driver gets no cash notification (record or correction)');
select is((select count(*)::int from public.admin_audit where target_id = tests.id('hDem')), 2,
  'L9: both are still audited');

-- ================================================================ M1: fees kept by drivers, and the setting impact
select set_config('t.impact',
  (select row(count(distinct o.driver_id)::int, count(*)::int, coalesce(sum(o.delivery_fee_iqd), 0)::bigint, true)::text
     from public.orders o
    where o.status = 'delivered' and o.cash_handover_id is null and o.driver_id is not null and o.delivery_fee_iqd > 0),
  true);
select tests.as_user(tests.id('admin'));
select is(
  (select row(driver_count, order_count, fees_iqd, includes_delivery_fee)::text from public.cash_fee_setting_impact()),
  current_setting('t.impact'),
  'M1: cash_fee_setting_impact = delivery fees on the cash held now (drivers, orders, total, current setting)');
select ok((select fees_iqd >= 2000 and driver_count >= 2 from public.cash_fee_setting_impact()),
  'M1: it counts this file''s outstanding fees (drvFee and drvDel hold 1,000 each)');
select lives_ok($$ select public.update_app_settings('{"cash_handover_includes_delivery_fee": false}') $$,
  'M1: admin: fee stays with the driver');
select tests.as_user(tests.id('staff'));
select set_config('t.fee', tests.rec_json(tests.id('drvFee'), 1000, 1, 1000, null, tests.key(7))::text, true);
select tests.as_user(tests.id('admin'));
select lives_ok($$ select public.update_app_settings('{"cash_handover_includes_delivery_fee": true}') $$, 'M1: fee back to the shop');
select set_config('t.rep', public.report_cash(public.baghdad_today() - 30, public.baghdad_today())::text, true);
select tests.as_postgres();
select set_config('t.kept', (select coalesce(sum(fees_iqd), 0)::bigint from public.cash_handovers
                               where kind = 'handover' and not includes_delivery_fee
                                 and recorded_at >= private.baghdad_start(public.baghdad_today() - 30)
                                 and recorded_at <  private.baghdad_start(public.baghdad_today() + 1))::text, true);
select is(
  (select (d ->> 'fees_kept_iqd')::int from jsonb_array_elements(current_setting('t.rep')::jsonb -> 'drivers') d
    where d ->> 'driver_id' = tests.id('drvFee')::text),
  1000, 'M1: report_cash per driver: fees_kept_iqd = the fee of the handover recorded with "fee stays with the driver"');
select is(
  (select (d ->> 'fees_kept_iqd')::int from jsonb_array_elements(current_setting('t.rep')::jsonb -> 'drivers') d
    where d ->> 'driver_id' = tests.id('drv')::text),
  0, 'M1: a handover with the fee going to the shop keeps 0');
select is((current_setting('t.rep')::jsonb -> 'totals' ->> 'fees_kept_iqd')::bigint, current_setting('t.kept')::bigint,
  'M1: report_cash totals.fees_kept_iqd = Σ fees of goods-only handovers in the range');

-- ================================================================ T6: after the driver is deleted
select tests.as_user(tests.id('staff'));
select set_config('t.del', tests.rec_json(tests.id('drvDel'), 2000, 1, 2000, null, tests.key(8))::text, true);
select tests.remember('hDel', (current_setting('t.del')::jsonb ->> 'handover_id')::uuid);
select tests.as_service();
select is(tests.err(format($$ select public.begin_account_deletion(%L) $$, tests.id('drvDel'))), 'OK',
  'T6: after the handover the driver can delete the account');
select tests.as_postgres();
delete from auth.users where id = tests.id('drvDel');
select tests.as_user(tests.id('admin'));
select ok((select driver_id is null and driver_name is null and received_iqd = 2000
             from public.cash_handover_history() where id = tests.id('hDel')),
  'T6: history keeps the handover with driver_id and driver_name null ("سائق محذوف" in the panel)');
select ok((select coalesce(bool_or((d ->> 'handover_count')::int >= 1 and d ->> 'full_name' is null), false)
             from jsonb_array_elements(public.report_cash(public.baghdad_today(), public.baghdad_today()) -> 'drivers') d
            where d ->> 'driver_id' is null),
  'T6: report_cash groups the deleted driver''s handovers under a null driver');
select tests.as_user(tests.id('staff'));
select ok((select driver_id is null from public.cash_handover_history() where id = tests.id('hDel')),
  'T6: staff see it too (within 7 days)');

-- ================================================================ L1: lock order in begin_account_deletion
select tests.as_postgres();
select ok(
  (select position('cash_handover:' in prosrc) > 0 and position('cash_handover:' in prosrc) < position('for update' in prosrc)
     from pg_proc where oid = 'public.begin_account_deletion(uuid)'::regprocedure),
  'L1: begin_account_deletion takes the cash_handover lock before locking the profile row');
select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('public.correct_cash_handover(uuid, bigint, text, bigint)'::regprocedure,
                    'public.cash_fee_setting_impact()'::regprocedure)
      and p.prosecdef and p.proconfig = array['search_path=""']
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')),
  2, 'the replaced/new RPCs: SECURITY DEFINER, search_path pinned, authenticated only');
select is((select count(*)::int from pg_proc where proname = 'correct_cash_handover'), 1,
  'the old 3-argument correct_cash_handover is gone (one signature)');

select * from finish();
