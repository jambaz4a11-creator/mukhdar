// معالج HTTP لطلب تسجيل سائق (T28، SPEC-driver §3 و§4.2). لا حساب Auth يُنشأ هنا أبداً: الطلب يُحفظ
// معلّقاً (submit_driver_request) حتى يتصل الأدمن ويوافق. بلا اعتماديات خارجية (يُختبر مباشرة).
//
// الطلب:  POST {"full_name": "...", "phone": "07701234567", "device_secret": "<43 base64url>", "push_token"?: "..."}
// الرد:   201 {"request_id": uuid}
//         أو {"error": CODE} برموز عامة فقط (packages/shared/src/errors.ts، SPEC-backend §8):
//         400 INVALID_REQUEST | PHONE_INVALID | NAME_INVALID، 403 NOT_ALLOWED (أصل غير مسموح)،
//         405 INVALID_REQUEST، 409 PHONE_TAKEN | REQUEST_EXISTS، 429 RATE_LIMITED | TOO_MANY_PENDING،
//         500 REGISTER_FAILED (فشل الحد أو قاعدة البيانات: تفشل مغلقة).
//
// الترتيب: حد المعدل (IP المنصة + الرقم إن صلح) **قبل** أي فحص آخر، فكل محاولة تُحسب حتى الخاطئة.
// السر لا يغادر هذا الملف إلا كـ SHA-256؛ لا يُسجَّل الجسم ولا السر ولا الـ hash ولا الرقم كاملاً ولا الاسم.
import { normalizeIraqiPhone, toStoredPhone } from '../../../packages/shared/src/phone.ts';
import { withCors } from '../_shared/cors.ts';
import {
  fail,
  isDeviceSecret,
  json,
  maskPhone,
  platformClientIp,
  readSmallJson,
  rejectForeignOrigin,
  scrub,
  sha256Hex,
} from '../_shared/driver.ts';

export type SubmitError =
  | 'PHONE_TAKEN'
  | 'REQUEST_EXISTS'
  | 'TOO_MANY_PENDING'
  | 'NAME_INVALID'
  | 'PHONE_INVALID'
  | 'INVALID_REQUEST';

export interface SubmitInput {
  phone: string;
  fullName: string;
  secretHash: string;
  pushToken: string | null;
}

export interface DriverRegisterDeps {
  /** public.driver_request_rate_hit(ip, phone): يسجّل المحاولة؛ false إن تجاوز الـ IP أو الرقم الحد. */
  rateHit(ip: string, phone: string | null): Promise<boolean>;
  /** public.submit_driver_request: {id} أو {error: رمز قاعدة البيانات (message)}. يرمي لفشل الشبكة. */
  submit(input: SubmitInput): Promise<{ id: string } | { error: string }>;
  log?: (msg: string, extra?: unknown) => void;
}

const STATUS: Record<SubmitError, number> = {
  PHONE_TAKEN: 409,
  REQUEST_EXISTS: 409,
  TOO_MANY_PENDING: 429,
  NAME_INVALID: 400,
  PHONE_INVALID: 400,
  INVALID_REQUEST: 400,
};

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export function createDriverRegisterHandler(
  deps: DriverRegisterDeps,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return fail(405, 'INVALID_REQUEST');

    const ip = platformClientIp(req.headers);
    const body = await readSmallJson(req);
    const e164 = typeof body?.phone === 'string' ? normalizeIraqiPhone(body.phone) : null;
    const phone = e164 ? toStoredPhone(e164) : null;
    const name = typeof body?.full_name === 'string' ? body.full_name.trim() : null;
    const secret = isDeviceSecret(body?.device_secret) ? body.device_secret : null;
    const hidden = [
      typeof body?.device_secret === 'string' ? body.device_secret : null,
      phone,
      phone?.slice(3),
      name,
    ];
    const logErr = (msg: string, e: unknown) => deps.log?.(msg, scrub(e, ...hidden));

    // 1) الحد قبل أي عمل (الجسم الخاطئ يُحسب على الـ IP وحده)
    let allowed: boolean;
    try {
      allowed = await deps.rateHit(ip, phone);
    } catch (e) {
      logErr('driver-register rate check failed', e);
      return fail(500, 'REGISTER_FAILED');
    }
    if (!allowed) {
      deps.log?.('driver-register rate limited', { phone: maskPhone(phone) });
      return fail(429, 'RATE_LIMITED');
    }

    // 2) الجسم والرقم والاسم والسر
    if (!body) return fail(400, 'INVALID_REQUEST');
    if (!phone) return fail(400, 'PHONE_INVALID');
    const nameLength = name === null ? 0 : [...name].length;
    if (name === null || nameLength < 2 || nameLength > 80) return fail(400, 'NAME_INVALID');
    if (!secret) return fail(400, 'INVALID_REQUEST');
    const token =
      typeof body.push_token === 'string' &&
      body.push_token.length <= 255 &&
      EXPO_TOKEN.test(body.push_token)
        ? body.push_token
        : null;

    // 3) SHA-256 ثم الحفظ
    const secretHash = await sha256Hex(secret);
    hidden.push(secretHash, token);
    let result: { id: string } | { error: string };
    try {
      result = await deps.submit({ phone, fullName: name, secretHash, pushToken: token });
    } catch (e) {
      logErr('driver-register submit failed', e);
      return fail(500, 'REGISTER_FAILED');
    }
    if ('error' in result) {
      const code = result.error as SubmitError;
      if (Object.hasOwn(STATUS, code)) {
        deps.log?.('driver-register refused', { code, phone: maskPhone(phone) });
        return fail(STATUS[code], code);
      }
      logErr('driver-register submit error', result.error);
      return fail(500, 'REGISTER_FAILED');
    }

    deps.log?.('driver-register done', { request_id: result.id, phone: maskPhone(phone) });
    return json(201, { request_id: result.id });
  };
}

/**
 * ما تخدمه index.ts: CORS بأصول ALLOWED_ORIGINS (نفس آلية الدوال الأخرى)، وأي أصل آخر يُرفض 403 قبل العمل.
 * التطبيق الأصلي لا يرسل Origin فيمر.
 */
export function createDriverRegisterServer(
  deps: DriverRegisterDeps,
  allowedOrigins: ReadonlySet<string>,
): (req: Request) => Promise<Response> {
  return withCors(
    rejectForeignOrigin(createDriverRegisterHandler(deps), allowedOrigins),
    allowedOrigins,
  );
}
