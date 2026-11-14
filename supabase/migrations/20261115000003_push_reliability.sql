-- =====================================================================
-- موثوقية الإشعارات (مراجعة 2026-11-14: S1، S2، N3)
--   S1: فشل التشغيل (Vault أو pg_net) لا يُفشل المعاملة التي كتبت الإشعار (مثل place_order):
--       الخطأ يتحول إلى warning، و pg_cron يلتقط الصف خلال دقيقة.
--   S2: طلب HTTP واحد على الأكثر لكل معاملة من الـ trigger (كانت كل جملة insert تطلب الدالة،
--       مثلاً 'ready' يكتب صفين بجملتين). علامة محلية للمعاملة؛ لا نافذة زمنية بين المعاملات
--       كي لا ينتظر صف معاملة أخرى حتى دورة الـ cron.
--   N3: تنظيف يومي: سجل pg_cron أقدم من 7 أيام، والإشعارات المنتهية (مرسلة أو فاشلة نهائياً)
--       أقدم من 30 يوماً.
-- =====================================================================

-- الإرسال الفعلي (منسوخ من 20261112000003 بدون تغيير بالمنطق)؛ يرجع true إن أُرسل طلب HTTP
create function private.push_kick_post(p_only_if_pending boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url';
  if nullif(v_url, '') is null then
    return false;  -- البيئة غير مضبوطة (محلياً/CI): لا شيء
  end if;
  if p_only_if_pending and not exists (
       select 1 from public.notification_outbox o
        where o.sent_at is null and o.attempts < 5
          and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')) then
    return false;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  perform net.http_post(
    url                  := v_url,
    body                 := '{}'::jsonb,
    headers              := jsonb_build_object('Content-Type', 'application/json',
                                               'x-dispatch-secret', v_secret),
    timeout_milliseconds := 10000);
  return true;
end
$$;
revoke all on function private.push_kick_post(boolean) from public, anon, authenticated;

-- الاستدعاء المباشر (pg_cron): لا يرمي خطأ أبداً
create or replace function private.kick_push_dispatch(p_only_if_pending boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.push_kick_post(p_only_if_pending);
exception when others then
  raise warning 'push-dispatch kick failed: % (%)', sqlerrm, sqlstate;
end
$$;

-- الـ trigger: مرة واحدة لكل معاملة، ولا يُفشل المعاملة أبداً
create or replace function private.tg_kick_push_dispatch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('mukhdar.push_kicked', true) = '1' then
    return null;
  end if;
  begin
    if private.push_kick_post(false) then
      perform set_config('mukhdar.push_kicked', '1', true);  -- محلي للمعاملة
    end if;
  exception when others then
    raise warning 'push-dispatch kick failed: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end
$$;

-- ---------------------------------------------------------------------
-- N3: التنظيف اليومي
-- ---------------------------------------------------------------------
create function private.purge_push_history()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  delete from public.notification_outbox
   where created_at < now() - interval '30 days'
     and (sent_at is not null or attempts >= 5);
end
$$;
revoke all on function private.purge_push_history() from public, anon, authenticated;

-- 03:30 بتوقيت بغداد (00:30 UTC)، وقت هادئ
select cron.schedule('push-history-purge', '30 0 * * *', 'select private.purge_push_history()');
