// Edge Function: delete-account
// يستدعيها التطبيق (الزبون أو السائق) بـ JWT المستخدم:
//   supabase.functions.invoke('delete-account', { method: 'POST' })
// CORS: الأصول من سر ALLOWED_ORIGINS فقط (PWA الزبون على الويب)؛ الـ preflight يُرد عليه هنا.
// المفاتيح تحقنها Supabase (لا تغادر الخادم). T23 F H2: verify_jwt = false؛ التحقق من المستخدم هنا بـ
// auth.getUser (رمز ناقص أو غير صالح ← 401 قبل أي شيء، handler.ts).
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { createDeleteAccountServer } from './handler.ts';
import { parseAllowedOrigins } from '../_shared/cors.ts';
import { keyKind, secretKey, supabaseUrl } from '../_shared/keys.ts';

// T23 F H2: المفتاح الجديد (SUPABASE_SECRET_KEYS) أولاً، والقديم (SUPABASE_SERVICE_ROLE_KEY) احتياطاً
const url = supabaseUrl();
const key = secretKey();
console.log('keys', JSON.stringify({ secret: keyKind(key) })); // النوع فقط، لا القيمة

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(
  createDeleteAccountServer(
    {
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
    },
    parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  ),
);
