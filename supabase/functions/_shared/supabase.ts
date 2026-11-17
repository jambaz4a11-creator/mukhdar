// عميل الخدمة وتنفيذ AdminAuthDeps للدوال الإدارية (T19). المفاتيح تحقنها Supabase ولا تغادر الخادم؛
// T23 F H2: المفتاح الجديد (sb_secret_ / sb_publishable_) أولاً والقديم احتياطاً (keys.ts).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { type AdminAuthDeps, jwtAal, type ProfileRow } from './admin.ts';
import { parseAllowedOrigins } from './cors.ts';
import { keyKind, publishableKey, secretKey, supabaseUrl } from './keys.ts';

/** سر الدالة ALLOWED_ORIGINS (T23 H1): أصول لوحة الأدمن المسموحة، مفصولة بفواصل. */
export const allowedOrigins = () => parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS'));

export function serviceClient(): SupabaseClient {
  const key = secretKey();
  // نوع المفتاح فقط (new = sb_secret_، legacy = service_role)، لا قيمته: دليل بالسجل قبل إطفاء القديمة (RUNBOOK §17.5)
  console.log(
    'keys',
    JSON.stringify({ secret: keyKind(key), publishable: keyKind(publishableKey()) }),
  );
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function adminAuthDeps(admin: SupabaseClient): AdminAuthDeps {
  return {
    async getUser(jwt) {
      // getUser يتحقق من الرمز (التوقيع والجلسة) عند Auth؛ بعدها فقط نقرأ aal من نفس الرمز. هذا هو التحقق
      // الوحيد من المستخدم (verify_jwt = false منذ T23 F H2: بوابة Supabase لا تفهم المفاتيح الجديدة)، ويقبل
      // رموز HS256 القديمة ورموز مفاتيح التوقيع غير المتماثلة (ES256) معاً.
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data.user) return null;
      return { id: data.user.id, aal: jwtAal(jwt) };
    },
    async getProfile(userId) {
      const { data, error } = await admin
        .from('profiles')
        .select('role, is_active, phone, must_change_pin')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as ProfileRow | null) ?? null;
    },
    async touchSession(jwt) {
      // بجلسة المستدعي نفسها (auth.jwt() بقاعدة البيانات)، لا بمفتاح الخدمة. المفتاح المنشور بـ apikey
      // والـ JWT بـ Authorization (المفتاح الجديد ليس JWT فلا يوضع بـ Bearer).
      const user = createClient(supabaseUrl(), publishableKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data, error } = await user.rpc('touch_panel_session');
      if (error) throw new Error(error.message);
      return data === true;
    },
  };
}

/**
 * يسجّل محاولة (ناجحة أو فاشلة) ويرجع عدد محاولات هذا الأدمن بآخر ساعة **شاملة الحالية**
 * (admin_rate_hit بقفل لكل أدمن، فلا تجاوز بالتزامن؛ مراجعة T16-T19 L3).
 */
export async function rateHit(
  admin: SupabaseClient,
  kind: 'pin_reset' | 'user_creation',
  adminId: string,
): Promise<number> {
  const { data, error } = await admin.rpc('admin_rate_hit', {
    p_kind: kind,
    p_admin: adminId,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}

/** سطر سجل بلا جسم الطلب (لا PIN). */
export const log = (msg: string, extra?: unknown) =>
  console.log(msg, extra === undefined ? '' : JSON.stringify(extra));
