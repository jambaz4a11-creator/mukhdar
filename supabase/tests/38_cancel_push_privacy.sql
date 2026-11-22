-- 38: R3 M1 (2026-11-22). إشعار "تم إلغاء الطلب" للسائق المعيَّن = البلوك والبناية فقط، مهما كتب الأدمن/الموظف بسبب
-- الإلغاء (قد يحوي هاتف الزبون أو طابقه أو شقته). السبب يبقى بالطلب. كتابة بالدور الحقيقي (authenticated + JWT).
select plan(6);

select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('driver', tests.new_user('driver'));
select tests.remember('cust', tests.new_user('customer'));

select tests.remember('o1', tests.order_in('ready', tests.id('cust'), tests.id('driver')));
select tests.remember('o2', tests.order_in('out_for_delivery', tests.id('cust'), tests.id('driver')));

select tests.as_user(tests.id('staff'));
select public.set_order_status(tests.id('o1'), 'cancelled',
                               'الزبون رقمه 07701234567 الطابق 3 شقة 12 ما يرد');
select tests.as_user(tests.id('admin'));
select public.set_order_status(tests.id('o2'), 'cancelled', 'call +9647801112222, floor 4 apartment 9', false);
select tests.as_postgres();

select is((select count(*)::int from public.notification_outbox
            where audience = 'user' and user_id = tests.id('driver') and data ->> 'type' = 'cancelled'
              and data ->> 'order_id' in (tests.id('o1')::text, tests.id('o2')::text)),
  2, 'the assigned driver is told about both cancellations');

select is((select count(*)::int from public.notification_outbox
            where user_id = tests.id('driver') and data ->> 'type' = 'cancelled'
              and body !~ '^بلوك .+ - بناية .+$'),
  0, 'driver cancel body is exactly "بلوك X - بناية Y"');

select is((select count(*)::int from public.notification_outbox
            where (title || ' ' || body || ' ' || (data - 'order_id')::text) ~ '([+]?964|0)7[0-9]{8,9}'
               or (title || ' ' || body || ' ' || (data - 'order_id')::text) ~ '(طابق|شقة|floor|apartment)'),
  0, 'no outbox payload carries the phone/floor/apartment typed in the reason');

select is((select cancel_reason from public.orders where id = tests.id('o1')),
  'الزبون رقمه 07701234567 الطابق 3 شقة 12 ما يرد', 'the reason itself is kept on the order');

select is((select count(*)::int from public.notification_outbox
            where user_id = tests.id('cust') and data ->> 'status' = 'cancelled'
              and data ->> 'order_id' in (tests.id('o1')::text, tests.id('o2')::text)),
  2, 'the customer is still told (order number only)');

select ok(position('coalesce(v_reason, ''بلوك ' in
               pg_get_functiondef('public.set_order_status(uuid, public.order_status, text, boolean)'::regprocedure)) = 0,
  'set_order_status no longer sends the free-text reason to the driver');

select * from finish();
