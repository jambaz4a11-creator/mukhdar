// Edge Function: driver-register (T28، SPEC-driver §4.2)
// تطبيق السائق قبل أي حساب: supabase.functions.invoke('driver-register', { body: { full_name, phone,
// device_secret, push_token? } }) ← 201 {request_id} ← الحالة بـ rpc driver_request_status (anon).
// verify_jwt = false (قبل الدخول؛ المفتاح المنشور ليس JWT). الحماية: حدود المعدل بقاعدة البيانات، وسر الجهاز.
// لا ينشئ حساب Auth أبداً. المفاتيح تحقنها Supabase تلقائياً (keys.ts؛ لا تغادر الخادم).
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { createDriverRegisterServer } from './handler.ts';
import { parseAllowedOrigins } from '../_shared/cors.ts';
import { keyKind, secretKey, supabaseUrl } from '../_shared/keys.ts';

const url = supabaseUrl();
const key = secretKey();
console.log('keys', JSON.stringify({ secret: keyKind(key) })); // النوع فقط، لا القيمة

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(
  createDriverRegisterServer(
    {
      async rateHit(ip, phone) {
        const { data, error } = await admin.rpc('driver_request_rate_hit', {
          p_ip: ip,
          p_phone: phone,
        });
        if (error) throw new Error(error.message);
        return data === true;
      },
      async submit({ phone, fullName, secretHash, pushToken }) {
        const { data, error } = await admin.rpc('submit_driver_request', {
          p_phone: phone,
          p_full_name: fullName,
          p_secret_hash: secretHash,
          p_push_token: pushToken,
        });
        // message = الرمز (PHONE_TAKEN...) أو نص Postgres؛ المعالج يترجمه لرمز عام ولا يرجع النص للعميل
        if (error) return { error: error.message };
        if (typeof data !== 'string') throw new Error('submit_driver_request returned no id');
        return { id: data };
      },
      log: (msg, extra) => console.log(msg, extra === undefined ? '' : JSON.stringify(extra)),
    },
    parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  ),
);
