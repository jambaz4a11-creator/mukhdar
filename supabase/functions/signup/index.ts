// Edge Function: signup (ADR 0001، تحديث 2026-11-15)
// التسجيل العام بـ GoTrue مطفأ (Allow new users to sign up: OFF)؛ هذه الطريقة الوحيدة لإنشاء حساب:
//   supabase.functions.invoke('signup', { body: { phone, pin } })  ثم  signInWithPassword(...)
// verify_jwt = false (قبل الدخول؛ المفتاح المنشور ليس JWT). الحماية: حدود المعدل بقاعدة البيانات.
// SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY تحقنهما Supabase تلقائياً (لا يغادران الخادم).
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { createSignupHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const EXISTS_CODES = new Set(['phone_exists', 'user_already_exists']);

Deno.serve(
  createSignupHandler({
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
  }),
);
