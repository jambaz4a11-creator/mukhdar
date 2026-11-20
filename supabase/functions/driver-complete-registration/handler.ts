// معالج HTTP لاكتمال تسجيل سائق موافَق عليه (T28، SPEC-driver §3 و§4.4). من يملك سر الجهاز فقط يحوّل
// الطلب الموافَق عليه إلى حساب سائق فعّال برمزه هو (بلا must_change_pin). بلا اعتماديات خارجية.
//
// الطلب:  POST {"request_id": uuid, "device_secret": "<43 base64url>", "pin": "482915"}
// الرد:   201 {"created": true}  ← التطبيق يدخل بـ signInWithPassword
//         أو {"error": CODE[, "detail"]}: 400 INVALID_REQUEST | PIN_INVALID (detail)، 403 NOT_ALLOWED (أصل)،
//         404 REQUEST_NOT_FOUND، 405 INVALID_REQUEST، 409 REQUEST_NOT_APPROVED | PHONE_TAKEN،
//         410 REQUEST_EXPIRED، 429 RATE_LIMITED، 500 INTERNAL.
//
// الترتيب: حد IP المنصة ← الجسم ← SHA-256 ← begin_driver_completion ← validatePin برقم الطلب ←
// auth.admin.createUser ← finish_driver_registration؛ فشلها ← حذف الحساب المُنشأ (لا حساب يتيم بدور زبون).
// ضغطتان متزامنتان: GoTrue يقبل حساباً واحداً للرقم، والثانية PHONE_TAKEN (لا تحذف شيئاً)؛ إن رجع GoTrue
// خطأ قاعدة بيانات للخاسر بدل phone_exists، يُفحص profiles: للرقم حساب ← PHONE_TAKEN، وإلا 500.
// لا يُسجَّل الجسم ولا السر ولا الـ hash ولا الـ PIN ولا الرقم كاملاً.
import { normalizePin, validatePin } from '../../../packages/shared/src/pin.ts';
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

export type BeginResult =
  | { phone: string; fullName: string }
  | { error: 'REQUEST_NOT_FOUND' | 'REQUEST_NOT_APPROVED' | 'REQUEST_EXPIRED' | string };

export interface DriverCompleteDeps {
  /** public.driver_request_rate_hit(ip, null): الـ IP وحده (نفس حد التسجيل). */
  rateHit(ip: string): Promise<boolean>;
  /** public.begin_driver_completion: رقم الطلب واسمه، أو {error: رمز قاعدة البيانات}. يرمي لفشل الشبكة. */
  begin(requestId: string, secretHash: string): Promise<BeginResult>;
  /** auth.admin.createUser({phone, password: pin, phone_confirm: true}): {id} أو 'exists'. */
  createUser(phone: string, pin: string): Promise<{ id: string } | 'exists'>;
  /** public.finish_driver_registration: يرمي عند أي فشل. */
  finish(requestId: string, userId: string): Promise<void>;
  /** auth.admin.deleteUser (التراجع). */
  deleteUser(userId: string): Promise<void>;
  /**
   * هل للرقم حساب الآن؟ (profiles.phone). بعد فشل createUser غير "exists": بسباق ضغطتين متزامنتين قد يرجع
   * GoTrue "Database error creating new user" للخاسر بدل phone_exists (لوحظ على dev)، فنفرّقه عن عطل حقيقي.
   */
  accountExists(phone: string): Promise<boolean>;
  log?: (msg: string, extra?: unknown) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BEGIN_STATUS: Record<string, number> = {
  REQUEST_NOT_FOUND: 404,
  REQUEST_NOT_APPROVED: 409,
  REQUEST_EXPIRED: 410,
};

export function createDriverCompleteHandler(
  deps: DriverCompleteDeps,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return fail(405, 'INVALID_REQUEST');

    const ip = platformClientIp(req.headers);
    const body = await readSmallJson(req);
    const rawSecret = typeof body?.device_secret === 'string' ? body.device_secret : null;
    const rawPin = typeof body?.pin === 'string' ? body.pin : null;
    const hidden: (string | null)[] = [rawSecret, rawPin, rawPin ? normalizePin(rawPin) : null];
    const logErr = (msg: string, e: unknown) => deps.log?.(msg, scrub(e, ...hidden));

    // 1) الحد قبل أي عمل
    let allowed: boolean;
    try {
      allowed = await deps.rateHit(ip);
    } catch (e) {
      logErr('driver-complete rate check failed', e);
      return fail(500, 'INTERNAL');
    }
    if (!allowed) {
      deps.log?.('driver-complete rate limited');
      return fail(429, 'RATE_LIMITED');
    }

    // 2) الجسم
    const requestId = typeof body?.request_id === 'string' ? body.request_id : null;
    if (
      !body ||
      !requestId ||
      !UUID_RE.test(requestId) ||
      !isDeviceSecret(rawSecret) ||
      rawPin === null
    ) {
      return fail(400, 'INVALID_REQUEST');
    }

    // 3) الطلب (السر يُطابَق بقاعدة البيانات كـ hash)
    const secretHash = await sha256Hex(rawSecret);
    hidden.push(secretHash);
    let begun: BeginResult;
    try {
      begun = await deps.begin(requestId, secretHash);
    } catch (e) {
      logErr('driver-complete begin failed', e);
      return fail(500, 'INTERNAL');
    }
    if ('error' in begun) {
      const status = BEGIN_STATUS[begun.error];
      if (status) {
        deps.log?.('driver-complete refused', { code: begun.error, request_id: requestId });
        return fail(status, begun.error);
      }
      logErr('driver-complete begin error', begun.error);
      return fail(500, 'INTERNAL');
    }
    const phone = begun.phone;
    hidden.push(phone, phone.slice(3), begun.fullName);

    // 4) الرمز بالخادم بنفس قواعد التطبيق، برقم الطلب
    const pin = normalizePin(rawPin);
    const pinError = validatePin(pin, phone);
    if (pinError) return fail(400, 'PIN_INVALID', pinError);

    // 5) الحساب
    let created: { id: string } | 'exists';
    try {
      created = await deps.createUser(phone, pin);
    } catch (e) {
      logErr('driver-complete createUser failed', e);
      let taken = false;
      try {
        taken = await deps.accountExists(phone);
      } catch (e2) {
        logErr('driver-complete account check failed', e2);
      }
      if (!taken) return fail(500, 'INTERNAL');
      created = 'exists';
    }
    if (created === 'exists') {
      // الطلب يبقى approved ليحله الأدمن (أو ضغطة ثانية متزامنة: الأولى أنشأته)
      deps.log?.('driver-complete phone taken', { request_id: requestId, phone: maskPhone(phone) });
      return fail(409, 'PHONE_TAKEN');
    }

    // 6) سائق فعّال + الطلب مكتمل؛ وإلا تراجع
    try {
      await deps.finish(requestId, created.id);
    } catch (e) {
      logErr('driver-complete finish failed', e);
      try {
        await deps.deleteUser(created.id);
      } catch (e2) {
        deps.log?.('driver-complete ORPHAN account: delete it by hand', {
          user_id: created.id,
          error: scrub(e2, ...hidden),
        });
      }
      // الطلب تغيّرت حالته بين begin وfinish (انتهت الموافقة، سُحبت): رد واضح لا 500 (الحساب حُذف أعلاه)
      const code = e instanceof Error ? e.message : '';
      const status = BEGIN_STATUS[code];
      if (status) return fail(status, code);
      return fail(500, 'INTERNAL');
    }

    deps.log?.('driver-complete done', { request_id: requestId, user_id: created.id });
    return json(201, { created: true });
  };
}

/** ما تخدمه index.ts: CORS بأصول ALLOWED_ORIGINS، وأي أصل آخر يُرفض 403 قبل العمل. */
export function createDriverCompleteServer(
  deps: DriverCompleteDeps,
  allowedOrigins: ReadonlySet<string>,
): (req: Request) => Promise<Response> {
  return withCors(
    rejectForeignOrigin(createDriverCompleteHandler(deps), allowedOrigins),
    allowedOrigins,
  );
}
