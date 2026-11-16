// عميل الخدمة وتنفيذ AdminAuthDeps للدوال الإدارية (T19). SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY
// تحقنهما Supabase تلقائياً ولا يغادران الخادم.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { AdminAuthDeps, ProfileRow } from './admin.ts';

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function adminAuthDeps(admin: SupabaseClient): AdminAuthDeps {
  return {
    async getUserId(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data.user) return null;
      return data.user.id;
    },
    async getProfile(userId) {
      const { data, error } = await admin
        .from('profiles')
        .select('role, is_active, phone')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as ProfileRow | null) ?? null;
    },
  };
}

export async function actionsLastHour(
  admin: SupabaseClient,
  kind: 'pin_reset' | 'user_creation',
  adminId: string,
): Promise<number> {
  const { data, error } = await admin.rpc('admin_actions_last_hour', {
    p_kind: kind,
    p_admin: adminId,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}

/** سطر سجل بلا جسم الطلب (لا PIN). */
export const log = (msg: string, extra?: unknown) =>
  console.log(msg, extra === undefined ? '' : JSON.stringify(extra));
