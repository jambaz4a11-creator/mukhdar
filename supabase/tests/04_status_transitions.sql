-- 04: set_order_status. جدول الأدوار كاملاً (مسار ready)، التحويلات غير الصحيحة، الإشعارات، الإلغاء والتسليم
select plan(98);

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('driver', tests.new_user('driver'));
select tests.remember('driver2', tests.new_user('driver'));
select tests.remember('cust', tests.new_user('customer'));
select tests.remember('cust2', tests.new_user('customer'));

-- ---------------------------------------------------------------- جدول الأدوار (8 تحويلات × 6 = 48 خلية)
-- كل خلية: طلب جديد للزبون cust بالحالة "من"؛ السائق driver معيَّن عليه (إلا pending: لا تعيين قبل preparing)،
-- ثم المستخدم يحاول التحويل. المتوقع OK أو NOT_ALLOWED.
create function tests.matrix() returns setof text language plpgsql as $$
declare
  c record;
  v_order uuid;
  v_got text;
  v_status public.order_status;
begin
  for c in
    select * from (values
      -- actor,    from,               to,                 expected
      ('admin',   'pending',          'preparing',        'OK'),
      ('admin',   'pending',          'cancelled',        'OK'),
      ('admin',   'preparing',        'ready',            'OK'),
      ('admin',   'preparing',        'cancelled',        'OK'),
      ('admin',   'ready',            'out_for_delivery', 'OK'),
      ('admin',   'ready',            'cancelled',        'OK'),
      ('admin',   'out_for_delivery', 'delivered',        'OK'),
      ('admin',   'out_for_delivery', 'cancelled',        'OK'),
      ('staff',   'pending',          'preparing',        'OK'),
      ('staff',   'pending',          'cancelled',        'OK'),
      ('staff',   'preparing',        'ready',            'OK'),
      ('staff',   'preparing',        'cancelled',        'OK'),
      ('staff',   'ready',            'out_for_delivery', 'OK'),          -- احتياطي (2026-11-16)
      ('staff',   'ready',            'cancelled',        'OK'),
      ('staff',   'out_for_delivery', 'delivered',        'OK'),          -- احتياطي (2026-11-16)
      ('staff',   'out_for_delivery', 'cancelled',        'NOT_ALLOWED'),
      ('driver',  'pending',          'preparing',        'NOT_ALLOWED'),
      ('driver',  'pending',          'cancelled',        'NOT_ALLOWED'),
      ('driver',  'preparing',        'ready',            'NOT_ALLOWED'),
      ('driver',  'preparing',        'cancelled',        'NOT_ALLOWED'),
      ('driver',  'ready',            'out_for_delivery', 'OK'),
      ('driver',  'ready',            'cancelled',        'NOT_ALLOWED'),
      ('driver',  'out_for_delivery', 'delivered',        'OK'),
      ('driver',  'out_for_delivery', 'cancelled',        'NOT_ALLOWED'),
      ('driver2', 'pending',          'preparing',        'NOT_ALLOWED'),
      ('driver2', 'pending',          'cancelled',        'NOT_ALLOWED'),
      ('driver2', 'preparing',        'ready',            'NOT_ALLOWED'),
      ('driver2', 'preparing',        'cancelled',        'NOT_ALLOWED'),
      ('driver2', 'ready',            'out_for_delivery', 'NOT_ALLOWED'),
      ('driver2', 'ready',            'cancelled',        'NOT_ALLOWED'),
      ('driver2', 'out_for_delivery', 'delivered',        'NOT_ALLOWED'),
      ('driver2', 'out_for_delivery', 'cancelled',        'NOT_ALLOWED'),
      ('cust',    'pending',          'preparing',        'NOT_ALLOWED'),
      ('cust',    'pending',          'cancelled',        'OK'),
      ('cust',    'preparing',        'ready',            'NOT_ALLOWED'),
      ('cust',    'preparing',        'cancelled',        'NOT_ALLOWED'),
      ('cust',    'ready',            'out_for_delivery', 'NOT_ALLOWED'),
      ('cust',    'ready',            'cancelled',        'NOT_ALLOWED'),
      ('cust',    'out_for_delivery', 'delivered',        'NOT_ALLOWED'),
      ('cust',    'out_for_delivery', 'cancelled',        'NOT_ALLOWED'),
      ('cust2',   'pending',          'preparing',        'NOT_ALLOWED'),
      ('cust2',   'pending',          'cancelled',        'NOT_ALLOWED'),
      ('cust2',   'preparing',        'ready',            'NOT_ALLOWED'),
      ('cust2',   'preparing',        'cancelled',        'NOT_ALLOWED'),
      ('cust2',   'ready',            'out_for_delivery', 'NOT_ALLOWED'),
      ('cust2',   'ready',            'cancelled',        'NOT_ALLOWED'),
      ('cust2',   'out_for_delivery', 'delivered',        'NOT_ALLOWED'),
      ('cust2',   'out_for_delivery', 'cancelled',        'NOT_ALLOWED')
    ) m(actor, from_s, to_s, expected)
  loop
    v_order := tests.order_in(c.from_s::public.order_status, tests.id('cust'),
                              case when c.from_s = 'pending' then null else tests.id('driver') end);
    perform tests.set_uid(tests.id(c.actor));
    v_got := tests.try(format('select public.set_order_status(%L, %L)', v_order, c.to_s));
    select status into v_status from public.orders where id = v_order;
    return next ok(
      v_got = c.expected and v_status = (case when c.expected = 'OK' then c.to_s else c.from_s end)::public.order_status,
      format('%s: %s -> %s = %s (got %s, status %s)', c.actor, c.from_s, c.to_s, c.expected, v_got, v_status));
  end loop;
end $$;

select * from tests.matrix();

-- ---------------------------------------------------------------- تحويلات غير صحيحة (حتى للأدمن، 17)
create function tests.invalid() returns setof text language plpgsql as $$
declare c record; v_order uuid;
begin
  for c in
    select * from (values
      ('pending', 'ready'), ('pending', 'out_for_delivery'), ('pending', 'delivered'), ('pending', 'pending'),
      ('preparing', 'out_for_delivery'), ('preparing', 'delivered'), ('preparing', 'pending'),
      ('ready', 'preparing'), ('ready', 'delivered'), ('ready', 'pending'),
      ('out_for_delivery', 'ready'), ('out_for_delivery', 'preparing'), ('out_for_delivery', 'pending'),
      ('delivered', 'cancelled'), ('delivered', 'preparing'),
      ('cancelled', 'pending'), ('cancelled', 'ready')
    ) t(from_s, to_s)
  loop
    v_order := tests.order_in(c.from_s::public.order_status, tests.id('cust'),
                              case when c.from_s = 'pending' then null else tests.id('driver') end);
    perform tests.set_uid(tests.id('admin'));
    return next is(tests.try(format('select public.set_order_status(%L, %L)', v_order, c.to_s)),
                   'INVALID_TRANSITION', format('admin: %s -> %s is INVALID_TRANSITION', c.from_s, c.to_s));
  end loop;
end $$;

select * from tests.invalid();

-- ---------------------------------------------------------------- أخطاء أخرى
select tests.remember('o_nodriver', tests.order_in('ready', tests.id('cust')));
select tests.set_uid(tests.id('admin'));
select throws_ok(format($$ select public.set_order_status(%L, 'out_for_delivery') $$, tests.id('o_nodriver')),
  'NO_DRIVER_ASSIGNED', 'ready -> out_for_delivery without a driver is rejected');
select tests.set_uid(tests.id('staff'));
select throws_ok(format($$ select public.set_order_status(%L, 'out_for_delivery') $$, tests.id('o_nodriver')),
  'NO_DRIVER_ASSIGNED', 'staff fallback: out_for_delivery still needs an assigned driver');
select tests.set_uid(tests.id('admin'));
select throws_ok($$ select public.set_order_status(gen_random_uuid(), 'preparing') $$,
  'ORDER_NOT_FOUND', 'unknown order');
select tests.set_uid(gen_random_uuid());
select throws_ok(format($$ select public.set_order_status(%L, 'preparing') $$, tests.id('o_nodriver')),
  'NOT_AUTHENTICATED', 'user without a profile is rejected');

-- ---------------------------------------------------------------- إشعارات 'ready'
-- بلا سائق: كل السائقين النشطين (طلب متاح) + الزبون
select tests.as_postgres();
select tests.remember('o_ready', tests.order_in('preparing', tests.id('cust')));
select is_empty($$ select 1 from public.notification_outbox
                   where data ->> 'order_id' = tests.id('o_ready')::text and audience = 'drivers' $$,
  'no driver notification before ready');
select tests.set_uid(tests.id('staff'));
select lives_ok(format($$ select public.set_order_status(%L, 'ready') $$, tests.id('o_ready')), 'staff sets ready');
select tests.as_postgres();
select row_eq($$ select title, body, data ->> 'type' from public.notification_outbox
                   where data ->> 'order_id' = tests.id('o_ready')::text and audience = 'drivers' $$,
  row('طلب جديد #' || (select order_number from public.orders where id = tests.id('o_ready')),
      'بلوك A1 - بناية 12'::text, 'new_order'::text),
  'ready (unassigned) notifies all active drivers: new order available');
select row_eq($$ select title, data ->> 'status' from public.notification_outbox
                   where data ->> 'order_id' = tests.id('o_ready')::text and audience = 'user' and user_id = tests.id('cust')
                     and data ->> 'status' = 'ready' $$,
  row('طلبك جاهز، بانتظار السائق'::text, 'ready'::text), 'ready notifies the customer');
select ok((select ready_at is not null from public.orders where id = tests.id('o_ready')), 'ready_at is set');

-- معيَّن مسبقاً (أثناء التحضير): سائقه فقط، لا كل السائقين
select tests.remember('o_ready_assigned', tests.order_in('preparing', tests.id('cust'), tests.id('driver')));
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o_ready_assigned'), 'ready');
select tests.as_postgres();
select is_empty($$ select 1 from public.notification_outbox
                   where data ->> 'order_id' = tests.id('o_ready_assigned')::text and audience = 'drivers' $$,
  'ready (already assigned) does not broadcast to all drivers');
select isnt_empty($$ select 1 from public.notification_outbox
                     where data ->> 'order_id' = tests.id('o_ready_assigned')::text and audience = 'user'
                       and user_id = tests.id('driver') and data ->> 'type' = 'ready' $$,
  'ready (already assigned) notifies the assigned driver');

-- ---------------------------------------------------------------- الإلغاء يرجع المخزون
select tests.remember('p', tests.new_product(1000, 10, true, 400));
select tests.remember('o_cancel', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p'), 3))));
select is((select qty from public.stock where product_id = tests.id('p')), 7, 'stock reserved at order time (10 - 3)');
select tests.set_uid(tests.id('cust'));
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled', ' changed my mind ') $$, tests.id('o_cancel')),
  'customer cancels own pending order');
select tests.as_postgres();
select is((select qty from public.stock where product_id = tests.id('p')), 10, 'cancel returns the stock');
select results_eq($$ select qty, type::text from public.inventory_movements
                     where order_id = tests.id('o_cancel') and type = 'cancel_return' $$,
  $$ values (3, 'cancel_return') $$, 'cancel_return movement recorded');
select row_eq($$ select cancelled_by, cancel_reason, cancelled_at is not null from public.orders where id = tests.id('o_cancel') $$,
  row(tests.id('cust'), 'changed my mind'::text, true), 'cancel fields set (reason trimmed)');
select isnt_empty($$ select 1 from public.notification_outbox
                     where audience = 'user' and user_id = tests.id('cust') and data ->> 'order_id' = tests.id('o_cancel')::text
                       and data ->> 'status' = 'cancelled' $$, 'customer notified about cancellation');

-- الإلغاء من ready (موظف) يرجع المخزون ويبلّغ السائق المعيَّن
select tests.remember('p_r', tests.new_product(1000, 10));
select tests.remember('o_ready_cancel', tests.place(tests.id('cust'), jsonb_build_array(tests.item(tests.id('p_r'), 4))));
select tests.set_uid(tests.id('admin'));
select public.set_order_status(tests.id('o_ready_cancel'), 'preparing');
select public.assign_driver(tests.id('o_ready_cancel'), tests.id('driver'));
select public.set_order_status(tests.id('o_ready_cancel'), 'ready');
select tests.set_uid(tests.id('staff'));
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled') $$, tests.id('o_ready_cancel')),
  'staff cancels a ready order');
select tests.as_postgres();
select is((select qty from public.stock where product_id = tests.id('p_r')), 10, 'cancel from ready returns the stock');
select isnt_empty($$ select 1 from public.notification_outbox
                     where audience = 'user' and user_id = tests.id('driver')
                       and data ->> 'order_id' = tests.id('o_ready_cancel')::text and data ->> 'type' = 'cancelled' $$,
  'assigned driver is notified when a ready order is cancelled');

-- ---------------------------------------------------------------- إلغاء طلب له سائق
select tests.remember('o_drv_cancel', tests.order_in('preparing', tests.id('cust'), tests.id('driver')));
select tests.set_uid(tests.id('staff'));
select public.set_order_status(tests.id('o_drv_cancel'), 'cancelled', repeat('x', 400));
select tests.as_postgres();
select isnt_empty($$ select 1 from public.notification_outbox
                     where audience = 'user' and user_id = tests.id('driver')
                       and data ->> 'order_id' = tests.id('o_drv_cancel')::text and data ->> 'type' = 'cancelled' $$,
  'assigned driver is notified when the order is cancelled');
select is_empty($$ select 1 from public.notification_outbox
                   where data ->> 'order_id' = tests.id('o_cancel')::text and data ->> 'type' = 'cancelled' $$,
  'no driver notification when no driver is assigned');
select is((select char_length(cancel_reason) from public.orders where id = tests.id('o_drv_cancel')), 300,
  'cancel reason is capped at 300 characters');
select is((select char_length(note) from public.order_status_history
            where order_id = tests.id('o_drv_cancel') and to_status = 'cancelled'), 300,
  'history note is capped at 300 characters');

-- ---------------------------------------------------------------- التسليم يحدّث daily_stats
-- لقطة قبل: نحفظها بجدول مؤقت (postgres)
create temp table stats_before as
  select coalesce(max(delivered_count), 0) as delivered, coalesce(max(cancelled_count), 0) as cancelled,
         coalesce(max(revenue_iqd), 0) as revenue, coalesce(max(delivery_fees_iqd), 0) as fees,
         coalesce(max(cost_iqd), 0) as cost, coalesce(max(gross_profit_iqd), 0) as profit
    from public.daily_stats where day = public.baghdad_today();

update public.app_settings set delivery_fee_iqd = 1000, min_order_iqd = 0, store_open = true;
select tests.remember('p_a', tests.new_product(2000, 10, true, 1200));
select tests.remember('p_b', tests.new_product(500, 10));          -- بلا سعر شراء = تكلفة 0
select tests.remember('o_deliver', tests.place(tests.id('cust'),
  jsonb_build_array(tests.item(tests.id('p_a'), 2), tests.item(tests.id('p_b'), 3))));
select tests.set_uid(tests.id('staff'));
select public.set_order_status(tests.id('o_deliver'), 'preparing');
select public.set_order_status(tests.id('o_deliver'), 'ready');
select tests.set_uid(tests.id('driver'));
select lives_ok(format($$ select public.accept_order(%L) $$, tests.id('o_deliver')), 'driver accepts the ready order');
select public.set_order_status(tests.id('o_deliver'), 'out_for_delivery');
select lives_ok(format($$ select public.set_order_status(%L, 'delivered') $$, tests.id('o_deliver')),
  'assigned driver delivers');
select tests.as_postgres();

-- subtotal = 2x2000 + 3x500 = 5500، الأجرة 1000، التكلفة = 2x1200 = 2400، الربح = 3100
select row_eq($$ select s.delivered_count - b.delivered, s.revenue_iqd - b.revenue, s.delivery_fees_iqd - b.fees,
                        s.cost_iqd - b.cost, s.gross_profit_iqd - b.profit
                   from public.daily_stats s, stats_before b where s.day = public.baghdad_today() $$,
  row(1, 5500::bigint, 1000::bigint, 2400::bigint, 3100::bigint),
  'delivery adds +1 delivered, revenue 5500, fees 1000, cost 2400, profit 3100');
select is((select s.cancelled_count - b.cancelled from public.daily_stats s, stats_before b
            where s.day = public.baghdad_today()), 0, 'delivery does not touch cancelled_count');
select ok((select preparing_at is not null and ready_at is not null and out_for_delivery_at is not null
                  and delivered_at is not null
             from public.orders where id = tests.id('o_deliver')), 'all status timestamps set');
select results_eq($$ select from_status::text, to_status::text from public.order_status_history
                     where order_id = tests.id('o_deliver') and coalesce(note, '') not in ('driver_assigned', 'driver_accepted')
                     order by id $$,
  $$ values (null, 'pending'), ('pending', 'preparing'), ('preparing', 'ready'), ('ready', 'out_for_delivery'),
            ('out_for_delivery', 'delivered') $$, 'history records every transition');
select is((select count(*)::int from public.notification_outbox
            where audience = 'user' and user_id = tests.id('cust') and data ->> 'order_id' = tests.id('o_deliver')::text),
  4, 'customer notified for preparing, ready, out_for_delivery and delivered');

-- الإلغاء يزيد cancelled_count (ومنه: الإلغاءان من ready و preparing أعلاه سُجّلا قبل اللقطة)
select tests.remember('o_cancel2', tests.order_in('ready', tests.id('cust')));
select tests.set_uid(tests.id('staff'));
select public.set_order_status(tests.id('o_cancel2'), 'cancelled');
select tests.as_postgres();
select is((select s.cancelled_count - b.cancelled from public.daily_stats s, stats_before b
            where s.day = public.baghdad_today()), 1, 'cancellation (from ready) increments cancelled_count');
-- T38 (SPEC-webpush §5.5): حمولة الصندوق (title/body/data) بلا نمط هاتف ولا طابق ولا شقة، لكل الأنواع والجمهور
select is((select count(*) from public.notification_outbox
            where (title || ' ' || body || ' ' || data::text) ~ '([+]?964|0)7[0-9]{8,9}'
               or (title || ' ' || body || ' ' || data::text) ~ '(طابق|شقة|floor|apartment)'), 0::bigint,
  'no outbox payload carries a phone number or a floor/apartment');

select * from finish();
