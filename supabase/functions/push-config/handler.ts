// معالج push-config (T44، SPEC-admin-push §2): يرجع مفتاح VAPID **العام** للوحة الأدمن وقت التشغيل، فلا تحتاج اللوحة
// متغير بناء بـ Cloudflare، وكل بيئة تأخذ مفتاحها من سر VAPID_PUBLIC_KEY الموجود (T38).
//
// الطلب:  POST (بلا جسم؛ supabase.functions.invoke)
// الرد:   200 {"vapid_public_key": "<base64url>"} مع Cache-Control عام لساعة
//         503 {"error": "NOT_CONFIGURED"} إن لم يُضبط السر أو لم يطابق شكل مفتاح عام P-256 غير مضغوط (65 بايتاً،
//             87 حرفاً base64url تبدأ بـ B). حارس: لو وُضع المفتاح **الخاص** بالخطأ (43 حرفاً) لا يُرجَع أبداً.
//         403 NOT_ALLOWED (أصل غير مسموح)، 405 لغير POST.
// بيانات عامة بلا حساب ولا قاعدة بيانات (verify_jwt = false). CORS من ALLOWED_ORIGINS نفسه.
import { withCors } from '../_shared/cors.ts';
import { fail, rejectForeignOrigin } from '../_shared/driver.ts';

export const PUBLIC_KEY_SHAPE = /^B[A-Za-z0-9_-]{86}$/;

/** المفتاح العام إن كان بالشكل الصحيح (بعد إزالة الحشو والمسافات)، وإلا null. */
export function publicKeyOrNull(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim().replace(/=+$/, '');
  return PUBLIC_KEY_SHAPE.test(v) ? v : null;
}

export function createPushConfigServer(
  rawPublicKey: string | undefined,
  allowed: ReadonlySet<string>,
): (req: Request) => Promise<Response> {
  const key = publicKeyOrNull(rawPublicKey);
  const handler = (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return Promise.resolve(fail(405, 'INVALID_REQUEST'));
    if (!key) return Promise.resolve(fail(503, 'NOT_CONFIGURED'));
    return Promise.resolve(
      new Response(JSON.stringify({ vapid_public_key: key }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      }),
    );
  };
  return withCors(rejectForeignOrigin(handler, allowed), allowed);
}
