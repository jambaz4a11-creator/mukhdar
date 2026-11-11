-- 04: set_order_status. جدول الأدوار كاملاً، التحويلات غير الصحيحة، الإلغاء والتسليم
select plan(67);

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('driver', tests.new_user('driver'));
select tests.remember('driver2', tests.new_user('driver'));
select tests.remember('cust', tests.new_user('customer'));
select tests.remember('cust2', tests.new_user('customer'));

-- ---------------------------------------------------------------- جدول الأدوار (36 خلية)
-- كل خلية: طلب جديد للزبون cust بالحالة "من"، السائق driver معيَّن عليه،
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
      ('admin',   'preparing',        'out_for_delivery', 'OK'),
      ('admin',   'preparing',        'cancelled',        'OK'),
      ('admin',   'out_for_delivery', 'delivered',        'OK'),
      ('admin',   'out_for_delivery', 'cancelled',        'OK'),
      ('staff',   'pending',          'preparing',        'OK'),
      ('staff',   'pending',          'cancelled',        'OK'),
      ('staff',   'preparing',        'out_for_delivery', 'NOT_ALLOWED'),
      ('staff',   'preparing',        'cancelled',        'OK'),
      ('staff',   'out_for_delivery', 'delivered',        'NOT_ALLOWED'),
      ('staff',   'out_for_delivery', 'cancelled',        'NOT_ALLOWED'),
      ('driver',  'pending',          'preparing',        'NOT_ALLOWED'),
      ('driver',  'pending',          'cancelled',        'NOT_ALLOWED'),
      ('driver',  'preparing',        'out_for_delivery', 'OK'),
      ('driver',  'preparing',        'cancelled',        'NOT_ALLOWED'),
      ('driver',  'out_for_delivery', 'delivered',        'OK'),
      ('driver',  'out_for_delivery', 'cancelled',        'NOT_ALLOWED'),
      ('driver2', 'pending',          'preparing',        'NOT_ALLOWED'),
      ('driver2', 'pending',          'cancelled',        'NOT_ALLOWED'),
      ('driver2', 'preparing',        'out_for_delivery', 'NOT_ALLOWED'),
      ('driver2', 'preparing',        'cancelled',        'NOT_ALLOWED'),
      ('driver2', 'out_for_delivery', 'delivered',        'NOT_ALLOWED'),
      ('driver2', 'out_for_delivery', 'cancelled',        'NOT_ALLOWED'),
      ('cust',    'pending',          'preparing',        'NOT_ALLOWED'),
      ('cust',    'pending',          'cancelled',        'OK'),
      ('cust',    'preparing',        'out_for_delivery', 'NOT_ALLOWED'),
      ('cust',    'preparing',        'cancelled',        'NOT_ALLOWED'),
      ('cust',    'out_for_delivery', 'delivered',        'NOT_ALLOWED'),
      ('cust',    'out_for_delivery', 'cancelled',        'NOT_ALLOWED'),
      ('cust2',   'pending',          'preparing',        'NOT_ALLOWED'),
      ('cust2',   'pending',          'cancelled',        'NOT_ALLOWED'),
      ('cust2',   'preparing',        'out_for_delivery', 'NOT_ALLOWED'),
      ('cust2',   'preparing',        'cancelled',        'NOT_ALLOWED'),
      ('cust2',   'out_for_delivery', 'delivered',        'NOT_ALLOWED'),
      ('cust2',   'out_for_delivery', 'cancelled',        'NOT_ALLOWED')
    ) m(actor, from_s, to_s, expected)
  loop
    v_order := tests.order_in(c.from_s::public.order_status, tests.id('cust'), tests.id('driver'));
    perform tests.set_uid(tests.id(c.actor));
    v_got := tests.try(format('select public.set_order_status(%L, %L)', v_order, c.to_s));
    select status into v_status from public.orders where id = v_order;
    return next ok(
      v_got = c.expected and v_status = (case when c.expected = 'OK' then c.to_s else c.from_s end)::public.order_status,
      format('%s: %s -> %s = %s (got %s, status %s)', c.actor, c.from_s, c.to_s, c.expected, v_got, v_status));
  end loop;
end $$;

select * from tests.matrix();

-- ---------------------------------------------------------------- تحويلات غير صحيحة (حتى للأدمن)
create function tests.invalid() returns setof text language plpgsql as $$
declare c record; v_order uuid;
begin
  for c in
    select * from (values
      ('pending', 'out_for_delivery'), ('pending', 'delivered'), ('pending', 'pending'),
      ('preparing', 'delivered'), ('preparing', 'pending'),
      ('out_for_delivery', 'preparing'), ('out_for_delivery', 'pending'),
      ('delivered', 'cancelled'), ('delivered', 'preparing'),
      ('cancelled', 'pending'), ('cancelled', 'preparing')
    ) t(from_s, to_s)
  loop
    v_order := tests.order_in(c.from_s::public.order_status, tests.id('cust'), tests.id('driver'));
    perform tests.set_uid(tests.id('admin'));
    return next is(tests.try(format('select public.set_order_status(%L, %L)', v_order, c.to_s)),
                   'INVALID_TRANSITION', format('admin: %s -> %s is INVALID_TRANSITION', c.from_s, c.to_s));
  end loop;
end $$;

select * from tests.invalid();

-- ---------------------------------------------------------------- أخطاء أخرى
select tests.remember('o_nodriver', tests.order_in('preparing', tests.id('cust')));
select tests.set_uid(tests.id('admin'));
select throws_ok(format($$ select public.set_order_status(%L, 'out_for_delivery') $$, tests.id('o_nodriver')),
  'NO_DRIVER_ASSIGNED', 'out_for_delivery without a driver is rejected');
select throws_ok($$ select public.set_order_status(gen_random_uuid(), 'preparing') $$,
  'ORDER_NOT_FOUND', 'unknown order');
select tests.set_uid(gen_random_uuid());
select throws_ok(format($$ select public.set_order_status(%L, 'preparing') $$, tests.id('o_nodriver')),
  'NOT_AUTHENTICATED', 'user without a profile is rejected');

-- ---------------------------------------------------------------- الإلغاء يرجع المخزون
select tests.as_postgres();
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
select tests.set_uid(tests.id('admin'));
select public.assign_driver(tests.id('o_deliver'), tests.id('driver'));
select public.set_order_status(tests.id('o_deliver'), 'preparing');
select tests.set_uid(tests.id('driver'));
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
select ok((select preparing_at is not null and out_for_delivery_at is not null and delivered_at is not null
             from public.orders where id = tests.id('o_deliver')), 'all status timestamps set');
select results_eq($$ select from_status::text, to_status::text from public.order_status_history
                     where order_id = tests.id('o_deliver') and coalesce(note, '') <> 'driver_assigned' order by id $$,
  $$ values (null, 'pending'), ('pending', 'preparing'), ('preparing', 'out_for_delivery'),
            ('out_for_delivery', 'delivered') $$, 'history records every transition');
select is((select count(*)::int from public.notification_outbox
            where audience = 'user' and user_id = tests.id('cust') and data ->> 'order_id' = tests.id('o_deliver')::text),
  3, 'customer notified for preparing, out_for_delivery and delivered');

-- الإلغاء يزيد cancelled_count
select tests.remember('o_cancel2', tests.order_in('pending', tests.id('cust')));
select tests.set_uid(tests.id('staff'));
select public.set_order_status(tests.id('o_cancel2'), 'cancelled');
select tests.as_postgres();
select is((select s.cancelled_count - b.cancelled from public.daily_stats s, stats_before b
            where s.day = public.baghdad_today()), 1, 'cancellation increments cancelled_count');

select * from finish();
