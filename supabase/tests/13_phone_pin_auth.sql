-- 13: الدخول بالهاتف + PIN بدون رسائل (ADR 0001): Send SMS Hook يرفض، كل حساب برقم صالح، رقم واحد = حساب واحد
select plan(17);

-- ---------------------------------------------------------------- Send SMS Hook
select is(
  private.hook_send_sms_reject('{"user": {"phone": "9647700000000"}, "sms": {"otp": "123456"}}'::jsonb)
    #>> '{error,http_code}',
  '403', 'the SMS hook always returns an error (http 403): nothing is ever sent');
select ok(
  private.hook_send_sms_reject('{}'::jsonb) ? 'error'
    and not (private.hook_send_sms_reject('{}'::jsonb) ? 'sms'),
  'the hook result is only an error object');
select ok(has_function_privilege('supabase_auth_admin', 'private.hook_send_sms_reject(jsonb)', 'execute'),
  'supabase_auth_admin (GoTrue) can run the hook');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
    where has_function_privilege(r.role, 'private.hook_send_sms_reject(jsonb)', 'execute')),
  0, 'anon/authenticated/service_role cannot run the hook');
select ok(not has_function_privilege('authenticated', 'private.tg_require_valid_phone()', 'execute'),
  'authenticated cannot run the phone guard directly');

-- ---------------------------------------------------------------- كل حساب برقم صالح
select throws_ok($$ insert into auth.users (id, aud, role) values (gen_random_uuid(), 'authenticated', 'authenticated') $$,
  'P0001', 'PHONE_INVALID', 'an account without a phone (e.g. email only) is rejected');
select throws_ok($$ insert into auth.users (id, phone, aud, role)
                    values (gen_random_uuid(), '07701234567', 'authenticated', 'authenticated') $$,
  'P0001', 'PHONE_INVALID', 'a local-format phone is rejected (must be 9647XXXXXXXXX)');
select throws_ok($$ insert into auth.users (id, phone, aud, role)
                    values (gen_random_uuid(), '+9647701234567', 'authenticated', 'authenticated') $$,
  'P0001', 'PHONE_INVALID', 'a phone with "+" is rejected (GoTrue stores digits only)');
select throws_ok($$ insert into auth.users (id, phone, aud, role)
                    values (gen_random_uuid(), '9647801234', 'authenticated', 'authenticated') $$,
  'P0001', 'PHONE_INVALID', 'a short phone is rejected');

select lives_ok($$ insert into auth.users (id, phone, aud, role)
                   values ('00000000-0000-0000-0000-0000000013a1', '9647711300001', 'authenticated', 'authenticated') $$,
  'a valid Iraqi mobile number is accepted');
select is((select phone from public.profiles where id = '00000000-0000-0000-0000-0000000013a1'),
  '9647711300001', 'profiles.phone is set from the account phone (PHONE_REQUIRED never blocks a real user)');

select throws_ok($$ update auth.users set phone = null where id = '00000000-0000-0000-0000-0000000013a1' $$,
  'P0001', 'PHONE_INVALID', 'the phone cannot be removed from an account');
select throws_ok($$ update auth.users set phone = '123' where id = '00000000-0000-0000-0000-0000000013a1' $$,
  'P0001', 'PHONE_INVALID', 'the phone cannot change to an invalid number');
-- GoTrue يكتب كل الأعمدة بكل تحديث (مثل last_sign_in_at): نفس الرقم لا يُفحص ولا يُرفض
select lives_ok($$ update auth.users set phone = phone, last_sign_in_at = now()
                   where id = '00000000-0000-0000-0000-0000000013a1' $$,
  'routine updates (same phone) are not blocked');

-- ---------------------------------------------------------------- رقم واحد = حساب واحد
select throws_ok($$ insert into auth.users (id, phone, aud, role)
                    values (gen_random_uuid(), '9647711300001', 'authenticated', 'authenticated') $$,
  '23505', null, 'a second account with the same phone is rejected');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'profiles_phone_key'
                   and indexdef ilike '%unique%'),
  'profiles.phone has a unique index');
select throws_ok($$ update public.profiles set phone = '07701234567'
                    where id = '00000000-0000-0000-0000-0000000013a1' $$,
  '23514', null, 'profiles.phone keeps the 9647XXXXXXXXX format');

select * from finish();
