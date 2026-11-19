// مشترك بين driver-register وdriver-complete-registration (T28، SPEC-driver §4.2/§4.4). بلا اعتماديات
// خارجية (يُختبر مباشرة بـ deno test). لا يُسجَّل جسم الطلب أبداً (فيه سر الجهاز أو الـ PIN).

/**
 * IP العميل لحد المعدل: **`cf-connecting-ip` فقط**.
 * Supabase Edge Functions خلف Cloudflare، وCloudflare تضع هذه الترويسة لكل طلب **وتستبدل** أي قيمة يرسلها
 * العميل، فلا يقدر المتصل تزويرها. `x-forwarded-for` و`x-real-ip` يتحكم بها العميل (أو تُلحق بها قيمته)،
 * فلا تُقرأ هنا أبداً (دالة signup القديمة تقرأ x-forwarded-for احتياطاً؛ هاتان لا).
 * فُحص على mukhdar-dev: `pnpm it:signup` (ترويسة cf-connecting-ip مزوّرة لا تصير المفتاح) و`pnpm it:driver-register`
 * (ترويسات مزوّرة لا تتجاوز الحد). بلا الترويسة (محلي/CI): مفتاح مشترك "unknown" (أحوط: الكل بحد واحد).
 */
export function platformClientIp(headers: Headers): string {
  return headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

/** سر الجهاز: 32 بايت base64url بلا حشو = 43 محرفاً، وآخر محرف بلا بتات زائدة (فكّه = 32 بايت بالضبط). */
export function isDeviceSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value);
}

/** SHA-256 (hex) لنص UTF-8؛ نفس ما تحسبه قاعدة البيانات بـ driver_request_status. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** للسجل فقط: 9647701234567 ← 9647******67 (لا رقم كامل بأي سطر). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '-';
  return `${phone.slice(0, 4)}******${phone.slice(-2)}`;
}

export const MAX_BODY_BYTES = 2048;

/** جسم JSON صغير (كائن)، أو null. يتوقف عن القراءة بعد MAX_BODY_BYTES (لا يقرأ جسماً ضخماً كاملاً). */
export async function readSmallJson(req: Request): Promise<Record<string, unknown> | null> {
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const fail = (status: number, code: string, detail?: string) =>
  json(status, detail ? { error: code, detail } : { error: code });

/**
 * طلب بـ Origin ليس بـ ALLOWED_ORIGINS ← 403 قبل أي عمل (لا يُحسب على حد المعدل ولا يصل لقاعدة البيانات).
 * بلا Origin (التطبيق الأصلي، سكربت) أو بأصل مسموح ← يمر. يُلف داخل withCors (الـ preflight يبقى عنده).
 * يسد طلب "بسيط" بلا preflight (text/plain) من موقع آخر يستعمل متصفح زائر لإرسال طلبات.
 */
export function rejectForeignOrigin(
  handler: (req: Request) => Promise<Response>,
  allowed: ReadonlySet<string>,
): (req: Request) => Promise<Response> {
  return (req) => {
    const origin = req.headers.get('origin');
    if (origin !== null && !allowed.has(origin)) return Promise.resolve(fail(403, 'NOT_ALLOWED'));
    return handler(req);
  };
}

/**
 * نص خطأ للسجل بلا الأسرار: القيم المعروفة (السر، الـ hash، الرمز، الرقم، الاسم)، ثم احتياطاً أي hash
 * (64 hex) وأي تسلسل أرقام ≥ 9 (رقم هاتف بأي صيغة) حتى لو لم يُعرف بعد (قبل begin مثلاً).
 */
export function scrub(e: unknown, ...secrets: (string | null | undefined)[]): string {
  let text = e instanceof Error ? e.message : String(e);
  for (const s of secrets) if (s) text = text.split(s).join('***');
  return text.replace(/[0-9a-f]{64}/gi, '***').replace(/\+?\d{9,}/g, '***');
}
