-- =====================================================================
-- revoke_user_sessions (مراجعة T09-T15، S1؛ قرار المالك 2026-11-15): يبطل كل جلسات مستخدم.
-- فُحص على mukhdar-dev: تغيير كلمة السر (updateUser / updateUserById) **لا** يبطل الجلسات الأخرى
-- (refresh token القديم يبقى صالحاً). admin-reset-pin (T19) يستدعي هذه الدالة بعد ضبط الرمز الجديد.
-- حذف auth.sessions يحذف refresh tokens المرتبطة بها (cascade)؛ ونحذف أيضاً الرموز القديمة بلا جلسة.
-- access token (JWT) الصادر قبلها يبقى صالحاً حتى انتهائه (ساعة افتراضياً)، لا يمكن سحبه.
-- لـ service_role فقط (Edge Functions)، لا anon ولا authenticated.
-- =====================================================================

create function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_user_id is null then
    return 0;
  end if;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  return v_count;
end
$$;

comment on function public.revoke_user_sessions(uuid) is
  'service_role only (admin-reset-pin, T19): deletes all auth sessions and refresh tokens of a user. ADR 0001.';

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
