// Edge Function: driver-complete-registration (T28، SPEC-driver §4.4)
// الجهاز الموافَق عليه: supabase.functions.invoke('driver-complete-registration', { body: { request_id,
// device_secret, pin } }) ← 201 {created: true} ← signInWithPassword(phone, pin).
// verify_jwt = false (لا حساب بعد). الحماية: سر الجهاز (256 بت، hash فقط بالخادم) + حد IP بقاعدة البيانات.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { createDriverCompleteServer } from './handler.ts';
import { parseAllowedOrigins } from '../_shared/cors.ts';
import { keyKind, secretKey, supabaseUrl } from '../_shared/keys.ts';

const url = supabaseUrl();
const key = secretKey();
console.log('keys', JSON.stringify({ secret: keyKind(key) })); // النوع فقط، لا القيمة

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const EXISTS_CODES = new Set(['phone_exists', 'user_already_exists']);

Deno.serve(
  createDriverCompleteServer(
    {
      async rateHit(ip) {
        const { data, error } = await admin.rpc('driver_request_rate_hit', {
          p_ip: ip,
          p_phone: null,
        });
        if (error) throw new Error(error.message);
        return data === true;
      },
      async begin(requestId, secretHash) {
        const { data, error } = await admin.rpc('begin_driver_completion', {
          p_request_id: requestId,
          p_secret_hash: secretHash,
        });
        if (error) return { error: error.message };
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || typeof row.phone !== 'string')
          throw new Error('begin_driver_completion returned no row');
        return { phone: row.phone, fullName: String(row.full_name ?? '') };
      },
      async createUser(phone, pin) {
        const { data, error } = await admin.auth.admin.createUser({
          phone,
          password: pin,
          phone_confirm: true,
        });
        if (!error && data.user) return { id: data.user.id };
        if (
          error &&
          (EXISTS_CODES.has(error.code ?? '') ||
            /already (been )?registered|already exists/i.test(error.message))
        ) {
          return 'exists';
        }
        // الرسالة فقط (لا كائن الخطأ ولا الطلب)؛ المعالج يزيل الأسرار قبل السجل
        throw new Error(`${error?.code ?? 'auth_error'}: ${error?.message ?? 'no user returned'}`);
      },
      async finish(requestId, userId) {
        const { error } = await admin.rpc('finish_driver_registration', {
          p_request_id: requestId,
          p_user_id: userId,
        });
        if (error) throw new Error(error.message);
      },
      async deleteUser(userId) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw new Error(error.message);
      },
      async accountExists(phone) {
        const { data, error } = await admin
          .from('profiles')
          .select('id')
          .eq('phone', phone)
          .limit(1);
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
      log: (msg, extra) => console.log(msg, extra === undefined ? '' : JSON.stringify(extra)),
    },
    parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  ),
);
