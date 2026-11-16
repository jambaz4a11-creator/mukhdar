// معالج admin-reset-pin (T19، SPEC-admin §2.6، ADR 0001): الأدمن يضبط PIN جديداً لمستخدم نسي رمزه،
// بعد رسالة واتساب من نفس الرقم. بلا اعتماديات خارجية (يُختبر مباشرة).
//
// الطلب:  POST {"user_id": "<uuid>", "new_pin": "######"}   Authorization: Bearer <JWT الأدمن>
// الرد:   200 {"ok": true}، أو {"error": CODE[, "detail"]}:
//         401 NOT_AUTHENTICATED | 403 NOT_ALLOWED | 400 INVALID_REQUEST | 404 USER_NOT_FOUND |
//         403 ADMIN_ACCOUNT | 400 PIN_INVALID (detail = PIN_LENGTH/PIN_TRIVIAL/PIN_MATCHES_PHONE) |
//         429 TOO_MANY_RESETS | 500 INTERNAL
// الرمز لا يرجع بالرد ولا يُسجَّل (لا الجسم ولا الرمز بأي سجل). قواعد الرمز من packages/shared (لا نسخة).
import { normalizePin, validatePin } from '../../../packages/shared/src/pin.ts';
import {
  type AdminAuthDeps,
  errText,
  fail,
  json,
  readJsonObject,
  requireAdmin,
  UUID_RE,
} from '../_shared/admin.ts';

export const RESETS_PER_HOUR = 20;

export interface ResetPinDeps extends AdminAuthDeps {
  /** admin_actions_last_hour('pin_reset', admin) */
  resetsLastHour(adminId: string): Promise<number>;
  /** auth.admin.updateUserById(user_id, { password }) */
  updatePassword(userId: string, pin: string): Promise<void>;
  /** revoke_user_sessions(user_id): تسقط رموز التحديث على كل الأجهزة */
  revokeSessions(userId: string): Promise<void>;
  /** record_pin_reset(user_id, admin): سجل التدقيق بلا الرمز */
  recordReset(userId: string, adminId: string): Promise<void>;
  log?: (msg: string, extra?: unknown) => void;
}

export function createResetPinHandler(deps: ResetPinDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return fail(405, 'INVALID_REQUEST');

    const admin = await requireAdmin(req, deps);
    if (admin instanceof Response) return admin;

    const body = await readJsonObject(req);
    if (!body || typeof body.user_id !== 'string' || typeof body.new_pin !== 'string') {
      return fail(400, 'INVALID_REQUEST');
    }
    if (!UUID_RE.test(body.user_id)) return fail(404, 'USER_NOT_FOUND');
    const userId = body.user_id.toLowerCase();

    let target;
    try {
      target = await deps.getProfile(userId);
    } catch (e) {
      deps.log?.('admin-reset-pin profile lookup failed', errText(e));
      return fail(500, 'INTERNAL');
    }
    if (!target) return fail(404, 'USER_NOT_FOUND');
    // لا لحساب أدمن (ولا المستدعي نفسه): رمز الأدمن يغيّره صاحبه، أو صاحب المشروع بـ SQL.
    if (target.role === 'admin' || userId === admin) return fail(403, 'ADMIN_ACCOUNT');

    const pinError = validatePin(body.new_pin, target.phone ?? undefined);
    if (pinError) return fail(400, 'PIN_INVALID', pinError);

    let count: number;
    try {
      count = await deps.resetsLastHour(admin);
    } catch (e) {
      deps.log?.('admin-reset-pin rate check failed', errText(e));
      return fail(500, 'INTERNAL');
    }
    if (count >= RESETS_PER_HOUR) return fail(429, 'TOO_MANY_RESETS');

    try {
      await deps.updatePassword(userId, normalizePin(body.new_pin));
    } catch (e) {
      // رسالة Auth فقط (لا تحمل كلمة السر)
      deps.log?.('admin-reset-pin update failed', errText(e));
      return fail(500, 'INTERNAL');
    }

    // الرمز تغيّر: إبطال الجلسات والتدقيق يُحاولان كلاهما حتى لو فشل أحدهما.
    let ok = true;
    try {
      await deps.revokeSessions(userId);
    } catch (e) {
      ok = false;
      deps.log?.('admin-reset-pin revoke failed', errText(e));
    }
    try {
      await deps.recordReset(userId, admin);
    } catch (e) {
      ok = false;
      deps.log?.('admin-reset-pin audit failed', errText(e));
    }
    if (!ok) return fail(500, 'INTERNAL');

    deps.log?.('admin-reset-pin done', { user_id: userId, by: admin });
    return json(200, { ok: true });
  };
}
