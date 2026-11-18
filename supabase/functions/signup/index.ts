// Edge Function: signup (ADR 0001، تحديث 2026-11-15)
// التسجيل العام بـ GoTrue مطفأ (Allow new users to sign up: OFF)؛ هذه الطريقة الوحيدة لإنشاء حساب:
//   supabase.functions.invoke('signup', { body: { phone, pin } })  ثم  signInWithPassword(...)
// verify_jwt = false (قبل الدخول؛ المفتاح المنشور ليس JWT). الحماية: حدود المعدل بقاعدة البيانات.
// المفاتيح تحقنها Supabase تلقائياً (keys.ts؛ لا تغادر الخادم).
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { createSignupServer } from './handler.ts';
import { parseAllowedOrigins } from '../_shared/cors.ts';
import { keyKind, secretKey, supabaseUrl } from '../_shared/keys.ts';

// T23 F H2: المفتاح الجديد (SUPABASE_SECRET_KEYS) أولاً، والقديم (SUPABASE_SERVICE_ROLE_KEY) احتياطاً
const url = supabaseUrl();
const key = secretKey();
console.log('keys', JSON.stringify({ secret: keyKind(key) })); // النوع فقط، لا القيمة

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const EXISTS_CODES = new Set(['phone_exists', 'user_already_exists']);

Deno.serve(
  createSignupServer(
    {
      async rateHit(ip, phone) {
        const { data, error } = await admin.rpc('signup_rate_hit', { p_ip: ip, p_phone: phone });
        if (error) throw new Error(error.message);
        return data === true;
      },
      async createUser(phone, pin) {
        const { error } = await admin.auth.admin.createUser({
          phone,
          password: pin,
          phone_confirm: true,
        });
        if (!error) return 'created';
        if (
          EXISTS_CODES.has(error.code ?? '') ||
          /already (been )?registered|already exists/i.test(error.message)
        ) {
          return 'exists';
        }
        // الرسالة فقط (لا كائن الخطأ ولا الطلب): لا مجال لظهور الـ PIN بالسجل.
        throw new Error(`${error.code ?? 'auth_error'}: ${error.message}`);
      },
      log: (msg, extra) => console.log(msg, extra === undefined ? '' : JSON.stringify(extra)),
    },
    parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  ),
);
