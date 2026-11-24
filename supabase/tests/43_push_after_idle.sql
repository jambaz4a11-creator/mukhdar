-- 43: T44 متابعة (قرار المالك 2026-11-24، SPEC-admin-push §9 A4). إشعارات الأدمن/الموظف لا تتوقف بخروج الخمول من
-- اللوحة (12 ساعة تبقى للوحة نفسها)، وتتوقف فوراً بالخروج الصريح وتخفيض الدور والتعطيل والحظر والحذف.
-- كل كتابة مستخدم بدوره الحقيقي (زبون JWT aal1، موظف/أدمن بجلسة لوحة aal2). postgres للتجهيز ولمحاكاة الخمول، ولعمليات
-- auth (الحظر والحذف تتم بخدمة Auth لا بدور مستخدم). الاستلام بدور service_role كما يفعل push-dispatch.
select plan(25);

-- ================================================================ التجهيز (postgres)
select tests.remember('admin',   tests.new_user('admin'));
select tests.remember('staff',   tests.new_user('staff'));   -- يبقى، جلسته تموت بالخمول
select tests.remember('demoted', tests.new_user('staff'));
select tests.remember('off',     tests.new_user('staff'));   -- يُعطَّل
select tests.remember('banned',  tests.new_user('staff'));
select tests.remember('soft',    tests.new_user('staff'));   -- حذف ناعم
select tests.remember('hard',    tests.new_user('staff'));   -- حذف نهائي
select tests.remember('leaver',  tests.new_user('staff'));   -- خروج صريح
select tests.remember('cust',    tests.new_user('customer'));
select tests.remember('prod',    tests.new_product(1000, 50));
select tests.remember('addr',    tests.new_address(tests.id('cust')));
update public.notification_outbox set sent_at = now() where sent_at is null;

-- مفتاحا اشتراك صالحا الشكل؛ الـ endpoint فريد لكل جهاز
create function pg_temp.sub(p_tag text) returns void language sql as $$
  select public.register_web_push('https://fcm.googleapis.com/fcm/send/t43-' || p_tag, 'B' || repeat('k', 86), repeat('a', 22))
$$;
grant execute on function pg_temp.sub(text) to authenticated;

-- كل شخص يشغّل الإشعارات من اللوحة بجلسة aal2 حقيقية
select tests.as_panel(tests.id('admin'));
select lives_ok($$ select pg_temp.sub('admin') $$, 'admin subscribes a device');
select tests.remember('s_staff', tests.as_panel(tests.id('staff')));
select lives_ok($$ select pg_temp.sub('staff') $$, 'staff subscribes a device');
select tests.as_panel(tests.id('demoted')); select pg_temp.sub('demoted');
select tests.as_panel(tests.id('off'));     select pg_temp.sub('off');
select tests.as_panel(tests.id('banned'));  select pg_temp.sub('banned');
select tests.as_panel(tests.id('soft'));    select pg_temp.sub('soft');
select tests.as_panel(tests.id('hard'));    select pg_temp.sub('hard');
select tests.remember('s_leave', tests.as_panel(tests.id('leaver')));
select pg_temp.sub('leaver-a');
select tests.remember('s_leave2', tests.as_panel(tests.id('leaver')));   -- جهاز ثانٍ بجلسة أخرى
select pg_temp.sub('leaver-b');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where token like '%/t43-%'), 9,
  'nine subscriptions registered through register_web_push');

-- ================================================================ (1) الجلسة تنتهي بالخمول ← الإشعار يستمر
-- خمول 13 ساعة ثم حذف الجلسة (كما يفعل touch_panel_session والتنظيف اليومي)
insert into private.panel_sessions (session_id, user_id, last_seen)
values (tests.id('s_staff'), tests.id('staff'), now() - interval '13 hours')
on conflict (session_id) do update set last_seen = excluded.last_seen;
select tests.as_panel(tests.id('staff'), tests.id('s_staff'));
select is(public.current_user_role(), null, 'the idle staff panel session is dead (12 h rule unchanged)');
select throws_ok($$ select pg_temp.sub('staff-idle') $$, '42501', 'MFA_REQUIRED',
  'a dead panel session still cannot register a new subscription');
select tests.as_postgres();
delete from auth.sessions where id = tests.id('s_staff');
select is((select count(*)::int from auth.sessions where id = tests.id('s_staff')), 0, 'the session row is gone');

-- ================================================================ (2) تخفيض الدور والتعطيل (الأدمن بدوره الحقيقي)
select tests.as_panel(tests.id('admin'));
select lives_ok(format($$ select public.set_user_role(%L, 'customer', true) $$, tests.id('demoted')),
  'admin demotes a staff member to customer');
select lives_ok(format($$ select public.set_user_role(%L, 'staff', false) $$, tests.id('off')),
  'admin deactivates a staff member');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id in (tests.id('demoted'), tests.id('off'))), 0,
  'demotion and deactivation delete the subscriptions at once');

-- ================================================================ (3) الحظر والحذف (خدمة Auth)
update auth.users set banned_until = now() + interval '100 years' where id = tests.id('banned');
select is((select count(*)::int from public.push_tokens where user_id = tests.id('banned')), 0,
  'a ban deletes the subscriptions at once');
update auth.users set deleted_at = now() where id = tests.id('soft');
select is((select count(*)::int from public.push_tokens where user_id = tests.id('soft')), 0,
  'a soft delete deletes the subscriptions at once');
delete from auth.users where id = tests.id('hard');
select is((select count(*)::int from public.push_tokens where token like '%/t43-hard'), 0,
  'a hard delete removes the subscription (cascade)');

-- طبقة ثانية وقت الإرسال: اشتراك بقي/أُعيد لأي سبب لحساب مُخفَّض أو معطّل أو محظور أو محذوف ← لا يستلم
insert into public.push_tokens (user_id, token, platform, provider, keys, session_id)
select u.id, 'https://fcm.googleapis.com/fcm/send/t43-stale-' || u.n, 'web', 'webpush',
       jsonb_build_object('p256dh', 'B' || repeat('k', 86), 'auth', repeat('a', 22)), gen_random_uuid()
  from (values (tests.id('demoted'), 'demoted'), (tests.id('off'), 'off'),
               (tests.id('banned'), 'banned'), (tests.id('soft'), 'soft')) u(id, n);

-- ================================================================ (4) الخروج الصريح (بدور الموظف الحقيقي)
select tests.as_panel(tests.id('leaver'), tests.id('s_leave'));
select is(public.forget_session_push(), 1, 'explicit sign-out deletes this session''s subscription');
select tests.as_postgres();
select is((select array_agg(token) from public.push_tokens where user_id = tests.id('leaver')),
  array['https://fcm.googleapis.com/fcm/send/t43-leaver-b'], 'the other device (another session) keeps its own');
-- خروج صريح من جلسة لوحة ميتة (خمول) بـ JWT ما زال صالحاً: يحذف أيضاً
insert into private.panel_sessions (session_id, user_id, last_seen)
values (tests.id('s_leave2'), tests.id('leaver'), now() - interval '13 hours')
on conflict (session_id) do update set last_seen = excluded.last_seen;
select tests.as_panel(tests.id('leaver'), tests.id('s_leave2'));
select is(public.forget_session_push(), 1, 'sign-out from an idle panel session still deletes its subscription');
select tests.as_user_aal1(tests.id('cust'));
select is(public.forget_session_push(), 0, 'a customer session with no subscription: nothing to delete, no error');
select tests.as_anon();
select throws_ok($$ select public.forget_session_push() $$, '42501', null, 'anon cannot call forget_session_push');
select tests.as_postgres();
select is((select count(*)::int from public.push_tokens where user_id = tests.id('leaver')), 0,
  'the signed-out staff has no subscription left');

-- ================================================================ (5) أحداث حقيقية ثم الاستلام
select tests.as_user_aal1(tests.id('cust'));
select lives_ok(format($$ select tests.remember('o1', (public.place_order(%L, %L::jsonb, gen_random_uuid()) ->> 'order_id')::uuid) $$,
                       tests.id('addr'), jsonb_build_array(tests.item(tests.id('prod'), 1))),
  'a customer places an order after the staff session expired');
select tests.as_postgres();
insert into public.notification_outbox (audience, title, body, data)
values ('admins_only', 'T43-admins-only', 'b', jsonb_build_object('type', 'low_stock'));

create temp table t43_claimed (id bigint, title text, body text, data jsonb, attempts int, recipients jsonb);
grant all on t43_claimed to service_role;
select tests.as_service();
insert into t43_claimed select * from public.claim_push_notifications(100);
select tests.as_postgres();

select is((select array_agg(r ->> 'token' order by r ->> 'token')
             from t43_claimed c, jsonb_array_elements(c.recipients) r
            where c.data ->> 'type' = 'new_order' and c.data ->> 'order_id' = tests.id('o1')::text
              and r ->> 'token' like '%/t43-%'),
  array['https://fcm.googleapis.com/fcm/send/t43-admin', 'https://fcm.googleapis.com/fcm/send/t43-staff'],
  'new order reaches the admin and the staff whose panel session expired; nobody demoted, deactivated, banned, deleted or signed out');
select ok((select recipients @> '[{"token": "https://fcm.googleapis.com/fcm/send/t43-staff", "provider": "webpush"}]'
             and recipients @> jsonb_build_array(jsonb_build_object('keys', jsonb_build_object('auth', repeat('a', 22))))
             from t43_claimed where data ->> 'order_id' = tests.id('o1')::text),
  'the expired-session subscription is delivered with its keys');
select is((select array_agg(r ->> 'token')
             from t43_claimed c, jsonb_array_elements(c.recipients) r
            where c.title = 'T43-admins-only' and r ->> 'token' like '%/t43-%'),
  array['https://fcm.googleapis.com/fcm/send/t43-admin'], 'admins_only still reaches the admin only');
select is((select count(*)::int
             from t43_claimed c, jsonb_array_elements(c.recipients) r
            where r ->> 'token' like '%/t43-stale-%'),
  0, 'send-time check: no push to a demoted, deactivated, banned or soft-deleted account even if a row survived');

-- الحظر المنتهي: يعود الاستلام (حساب فعّال، الحظر بالماضي)
update auth.users set banned_until = now() - interval '1 minute' where id = tests.id('banned');
update public.profiles set is_active = true where id = tests.id('banned');
insert into public.notification_outbox (audience, title, body) values ('admins', 'T43-after-ban', 'b');
truncate t43_claimed;
select tests.as_service();
insert into t43_claimed select * from public.claim_push_notifications(100);
select tests.as_postgres();
select ok((select recipients @> '[{"token": "https://fcm.googleapis.com/fcm/send/t43-stale-banned"}]'
             from t43_claimed where title = 'T43-after-ban'),
  'an expired ban no longer blocks delivery');

select ok((select prosecdef from pg_proc where oid = 'private.tg_auth_user_push_revoke()'::regprocedure),
  'the auth.users trigger function is SECURITY DEFINER (runs for supabase_auth_admin)');

select * from finish();
