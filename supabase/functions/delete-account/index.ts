// Edge Function: delete-account
// يستدعيها التطبيق (الزبون أو السائق) بـ JWT المستخدم:
//   supabase.functions.invoke('delete-account', { method: 'POST' })
// SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY تحقنهما Supabase تلقائياً (لا يغادران الخادم).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createDeleteAccountHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(
  createDeleteAccountHandler({
    async getUserId(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data.user) return null;
      return data.user.id;
    },
    async begin(userId) {
      const { data, error } = await admin.rpc('begin_account_deletion', { p_user_id: userId });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
    async abort(userId, wasActive) {
      const { error } = await admin.rpc('abort_account_deletion', {
        p_user_id: userId,
        p_was_active: wasActive,
      });
      if (error) throw new Error(error.message);
    },
    log: (msg, extra) => console.log(msg, JSON.stringify(extra ?? null)),
  }),
);
