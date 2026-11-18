// معالج HTTP للتسجيل (ADR 0001، تحديث 2026-11-15): التسجيل العام بـ GoTrue مطفأ، والحساب الجديد
// يُنشأ هنا فقط بمفتاح الخدمة. بلا اعتماديات خارجية (يُختبر مباشرة).
//
// الطلب:  POST {"phone": "07701234567", "pin": "482915"}   (أي صيغة رقم عراقية، وأرقام عربية مقبولة)
// الرد:   201 {"created": true}  ← التطبيق يدخل بعدها بـ signInWithPassword من جهازه (حد GoTrue لكل IP
//         يبقى على IP الزبون، لا على IP الدالة المشترك بين الجميع).
//         أو {"error": CODE} برموز عامة فقط (packages/shared/src/errors.ts، SPEC-backend §8):
//         400 PHONE_INVALID | 400 PIN_INVALID | 409 PHONE_TAKEN | 429 RATE_LIMITED | 400/405/500 SIGNUP_FAILED
//
// الـ PIN لا يُسجَّل أبداً (ولا الجسم كاملاً)، ولا يغادر هذا الملف إلا إلى createUser.
// قواعد الرقم والرمز هي نفسها بالتطبيقات: نفس ملفات packages/shared (لا نسخة).
import { normalizeIraqiPhone, toStoredPhone } from '../../../packages/shared/src/phone.ts';
import { normalizePin, validatePin } from '../../../packages/shared/src/pin.ts';
import { withCors } from '../_shared/cors.ts';

export type CreateUserResult = 'created' | 'exists';

export interface SignupDeps {
  /** public.signup_rate_hit: يسجّل المحاولة ويرجع false إن تجاوز الـ IP أو الرقم الحد. */
  rateHit(ip: string, phone: string | null): Promise<boolean>;
  /** auth.admin.createUser (هاتف مؤكد، الـ PIN ككلمة سر). 'exists' إن كان الرقم مسجلاً. */
  createUser(phone: string, pin: string): Promise<CreateUserResult>;
  log?: (msg: string, extra?: unknown) => void;
}

const MAX_BODY_BYTES = 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fail = (status: number, code: string) => json(status, { error: code });

/**
 * IP الزبون كما تراه بوابة Supabase. cf-connecting-ip تضعه Cloudflare وتستبدل أي قيمة يرسلها العميل؛
 * وإلا أول عنصر بـ x-forwarded-for. بلا IP: مفتاح مشترك "unknown" (أحوط من عدم الحساب).
 * (فُحص على mukhdar-dev: RUNBOOK §14.)
 */
export function clientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return xff || 'unknown';
}

async function readBody(req: Request): Promise<{ phone?: unknown; pin?: unknown } | null> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const body: unknown = JSON.parse(text);
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function createSignupHandler(deps: SignupDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return fail(405, 'SIGNUP_FAILED');

    const ip = clientIp(req.headers);
    const body = await readBody(req);
    const e164 = typeof body?.phone === 'string' ? normalizeIraqiPhone(body.phone) : null;
    const phone = e164 ? toStoredPhone(e164) : null;

    // كل محاولة تُحسب قبل أي فحص آخر (حتى الجسم الخاطئ يُحسب على الـ IP).
    let allowed: boolean;
    try {
      allowed = await deps.rateHit(ip, phone);
    } catch (e) {
      deps.log?.('signup rate check failed', e instanceof Error ? e.message : String(e));
      return fail(500, 'SIGNUP_FAILED');
    }
    if (!allowed) return fail(429, 'RATE_LIMITED');

    if (!body) return fail(400, 'SIGNUP_FAILED');
    if (!phone) return fail(400, 'PHONE_INVALID');
    if (typeof body.pin !== 'string' || validatePin(body.pin, phone) !== null) {
      return fail(400, 'PIN_INVALID');
    }

    let result: CreateUserResult;
    try {
      result = await deps.createUser(phone, normalizePin(body.pin));
    } catch (e) {
      // رسالة الخطأ من Auth لا تحمل كلمة السر؛ ومع ذلك نسجّل الرسالة فقط، لا الطلب.
      deps.log?.('signup createUser failed', e instanceof Error ? e.message : String(e));
      return fail(500, 'SIGNUP_FAILED');
    }
    if (result === 'exists') return fail(409, 'PHONE_TAKEN');

    deps.log?.('signup done');
    return json(201, { created: true });
  };
}

/** ما تخدمه index.ts: المعالج + CORS بأصول ALLOWED_ORIGINS فقط (تطبيق الزبون على الويب، PWA). */
export function createSignupServer(
  deps: SignupDeps,
  allowedOrigins: ReadonlySet<string>,
): (req: Request) => Promise<Response> {
  return withCors(createSignupHandler(deps), allowedOrigins);
}
