-- 42: T44 (SPEC-admin-push §1). إشعارات اللوحة: طلب جديد بلا عنوان، "الزبون ألغى الطلب" للأدمن والموظف عند إلغاء الزبون
-- فقط وبلا سبب الإلغاء، وطلبات السواق للأدمن فقط. كل كتابة بالدور الحقيقي (JWT زبون aal1، موظف/أدمن بجلسة لوحة aal2)؛
-- postgres للتجهيز والقراءة فقط، والاستلام بدور service_role كما يفعل push-dispatch.
select plan(13);

-- ================================================================ التجهيز (postgres)
select tests.remember('admin', tests.new_user('admin'));
select tests.remember('staff', tests.new_user('staff'));
select tests.remember('c1', tests.new_user('customer'));
select tests.remember('c2', tests.new_user('customer'));
select tests.remember('prod', tests.new_product(1000, 10));
select tests.remember('a1', tests.new_address(tests.id('c1')));
select tests.remember('a2', tests.new_address(tests.id('c2')));
-- ما سبق بالصندوق ليس من هذا الاختبار
update public.notification_outbox set sent_at = now() where sent_at is null;

-- ================================================================ الزبون يطلب ثم يلغي (authenticated، aal1 مثل التطبيق)
select tests.as_user_aal1(tests.id('c1'));
select lives_ok(format($$ select tests.remember('o1', (public.place_order(%L, %L::jsonb, gen_random_uuid()) ->> 'order_id')::uuid) $$,
                       tests.id('a1'), jsonb_build_array(tests.item(tests.id('prod'), 2))),
  'customer places an order (as authenticated)');
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled', 'رقمي 07701234567 بلوك A1 بناية 12 الطابق 3 شقة 4') $$,
                       tests.id('o1')),
  'customer cancels their pending order with a free-text reason (as authenticated)');

select tests.as_user_aal1(tests.id('c2'));
select lives_ok(format($$ select tests.remember('o2', (public.place_order(%L, %L::jsonb, gen_random_uuid()) ->> 'order_id')::uuid) $$,
                       tests.id('a2'), jsonb_build_array(tests.item(tests.id('prod'), 1))),
  'a second customer places an order');

-- ================================================================ الموظف والأدمن على اللوحة (aal2 بجلسة حقيقية)
select tests.as_panel(tests.id('staff'));
select lives_ok($$ select public.register_web_push('https://fcm.googleapis.com/fcm/send/t42-staff',
                                                   'B' || repeat('s', 86), repeat('s', 22)) $$,
  'staff subscribes this device from the panel');
select lives_ok(format($$ select public.set_order_status(%L, 'cancelled', 'نفد المنتج') $$, tests.id('o2')),
  'staff cancels the second order');

select tests.as_panel(tests.id('admin'));
select lives_ok($$ select public.register_web_push('https://web.push.apple.com/t42-admin',
                                                   'B' || repeat('a', 86), repeat('a', 22)) $$,
  'admin subscribes this device from the panel (iPhone endpoint)');

select tests.as_postgres();
-- طلب سائق جديد: مصدره submit_driver_request (36_driver_requests.sql)؛ هنا شكل صفه فقط لفحص الجمهور
insert into public.notification_outbox (audience, title, body, data)
values ('admins_only', 'طلب سائق جديد', 'طلب سائق جديد، افتح طلبات السواق',
        jsonb_build_object('type', 'driver_request', 'request_id', gen_random_uuid()));

-- ================================================================ النصوص
select is((select body from public.notification_outbox
            where audience = 'admins' and data ->> 'type' = 'new_order' and data ->> 'order_id' = tests.id('o1')::text),
  (select 'المجموع ' || total_iqd || ' د.ع' from public.orders where id = tests.id('o1')),
  'new order push body for the panel is the total only (no block/building)');

select results_eq(
  format($$ select audience, title, body from public.notification_outbox
             where data ->> 'type' = 'customer_cancelled' and data ->> 'order_id' = %L $$, tests.id('o1')),
  format($$ values ('admins'::text, 'الزبون ألغى الطلب #' || (select order_number from public.orders where id = %L),
                    'افتح الطلب باللوحة'::text) $$, tests.id('o1')),
  'customer cancellation: one admins push, order number only, no reason');

select is((select count(*)::int from public.notification_outbox
            where data ->> 'type' = 'customer_cancelled' and data ->> 'order_id' = tests.id('o2')::text),
  0, 'a cancellation by staff does not notify the panel');

select is((select count(*)::int from public.notification_outbox
            where audience in ('admins', 'admins_only') and sent_at is null
              and ((title || ' ' || body || ' ' || (data - 'order_id' - 'request_id')::text) ~ '([+]?964|0)7[0-9]{8,9}'
                or (title || ' ' || body) ~ '(بلوك|بناية|وحدة|عمارة|طابق|شقة)')),
  0, 'no panel push carries a phone number or any part of the address');

-- ================================================================ الاستلام (push-dispatch بدور service_role)
create temp table t42_claimed (id bigint, title text, body text, data jsonb, attempts int, recipients jsonb);
grant all on t42_claimed to service_role;
select tests.as_service();
insert into t42_claimed select * from public.claim_push_notifications(100);
select tests.as_postgres();

select is((select array_agg(r ->> 'token' order by r ->> 'token')
             from t42_claimed c, jsonb_array_elements(c.recipients) r
            where c.data ->> 'type' = 'customer_cancelled' and c.data ->> 'order_id' = tests.id('o1')::text
              and r ->> 'token' like '%t42-%'),
  array['https://fcm.googleapis.com/fcm/send/t42-staff', 'https://web.push.apple.com/t42-admin'],
  'customer cancellation reaches both the staff and the admin device');

select is((select array_agg(r ->> 'token')
             from t42_claimed c, jsonb_array_elements(c.recipients) r
            where c.data ->> 'type' = 'driver_request' and r ->> 'token' like '%t42-%'),
  array['https://web.push.apple.com/t42-admin'],
  'a driver request reaches the admin device only, never staff');

select ok(position(' - بناية ' in pg_get_functiondef('public.place_order(uuid, jsonb, uuid, text)'::regprocedure)) = 0,
  'place_order no longer puts the address in any push');

select * from finish();
