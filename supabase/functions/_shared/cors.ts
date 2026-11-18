// CORS للدوال التي تستدعيها المتصفحات (T23 H1 + معاينة الويب): لوحة الأدمن (admin-reset-pin وadmin-create-user)
// وتطبيق الزبون PWA (signup وdelete-account). لوحة الأدمن تستدعيهما من المتصفح (functions.invoke). Supabase المستضاف
// لا يضيف CORS للدوال (Kong المحلي يضيفه، فكان CI يخفي الخلل)، فالدالة نفسها ترد على الـ preflight.
// - الأصول المسموحة من سر الدالة ALLOWED_ORIGINS (مفصولة بفواصل). فارغ أو غير مضبوط = لا أصل مسموح (يغلق).
// - يُرجَع الأصل نفسه فقط إن كان بالقائمة، أبداً '*'، مع Vary: Origin.
// - OPTIONS من أصل مسموح ← 204؛ من غيره ← 403 بلا ترويسات CORS (المتصفح يمنع الطلب).
// - طلب بلا Origin (سكربت، تطبيق أصلي) يمر بلا ترويسات CORS: الحماية هي JWT الأدمن لا CORS.
// التطبيقات الأصلية لا ترسل Origin فلا تتأثر.

export const CORS_ALLOW_HEADERS =
  'authorization, apikey, content-type, x-client-info, x-region, x-supabase-api-version';
export const CORS_ALLOW_METHODS = 'POST, OPTIONS';

/** "https://a.com, http://localhost:3000/" ← مجموعة أصول مطبّعة (بلا مسافات ولا / أخيرة). */
export function parseAllowedOrigins(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? '').split(',')) {
    const value = part.trim().replace(/\/+$/, '');
    if (!value || value === '*') continue; // '*' ممنوع: لا نفتح الدالة لكل موقع
    try {
      const u = new URL(value);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin === value) out.add(value);
    } catch {
      // قيمة غير صالحة تُتجاهل
    }
  }
  return out;
}

function withVary(headers: Headers): Headers {
  const vary = headers.get('Vary');
  if (!vary) headers.set('Vary', 'Origin');
  else if (!/\borigin\b/i.test(vary)) headers.set('Vary', `${vary}, Origin`);
  return headers;
}

/** يلف معالجاً: يرد على OPTIONS ويضيف ترويسات CORS لكل رد إن كان الأصل مسموحاً. */
export function withCors(
  handler: (req: Request) => Promise<Response>,
  allowed: ReadonlySet<string>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get('origin');
    const ok = origin !== null && allowed.has(origin);
    if (req.method === 'OPTIONS') {
      const headers = withVary(new Headers());
      if (!ok) return new Response(null, { status: 403, headers });
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
      headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
      headers.set('Access-Control-Max-Age', '600');
      return new Response(null, { status: 204, headers });
    }
    const res = await handler(req);
    const headers = withVary(new Headers(res.headers));
    if (ok) headers.set('Access-Control-Allow-Origin', origin);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
