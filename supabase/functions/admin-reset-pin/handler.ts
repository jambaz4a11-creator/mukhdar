// معالج admin-reset-pin (T19، SPEC-admin §2.6، ADR 0001): الأدمن يضبط PIN جديداً لمستخدم نسي رمزه،
// بعد رسالة واتساب من نفس الرقم. بلا اعتماديات خارجية (يُختبر مباشرة).
//
// الطلب:  POST {"user_id": "<uuid>", "new_pin": "######"}   Authorization: Bearer <JWT الأدمن>
// الرد:   200 {"ok": true}، أو {"error": CODE[, "detail"]}:
//         401 NOT_AUTHENTICATED | 403 NOT_ALLOWED | 403 PIN_CHANGE_REQUIRED (المستدعي برمز مؤقت) |
//         400 INVALID_REQUEST | 404 USER_NOT_FOUND |
//         403 ADMIN_ACCOUNT | 400 PIN_INVALID (detail = PIN_LENGTH/PIN_TRIVIAL/PIN_MATCHES_PHONE) |
//         429 TOO_MANY_RESETS | 500 RESET_INCOMPLETE (الرمز تغيّر لكن التدقيق أو إبطال الجلسات فشل؛ لا يُرسل
//         الرمز، وأعد المحاولة) | 500 INTERNAL
// الرمز لا يرجع بالرد ولا يُسجَّل (لا الجسم ولا الرمز بأي سجل). قواعد الرمز من packages/shared (لا نسخة).
import { normalizePin, validatePin } from '../../../packages/shared/src/pin.ts';
import {
  type AdminAuthDeps,
  errTextWithout,
  fail,
  json,
  readJsonObject,
  requireAdmin,
  UUID_RE,
} from '../_shared/admin.ts';

export const RESETS_PER_HOUR = 20;
/** محاولات إضافية لخطوات ما بعد تغيير الرمز (مراجعة جلسة C، M2). */
export const STEP_RETRIES = 2;

async function withRetries(step: () => Promise<void>): Promise<void> {
  let last: unknown;
  for (let i = 0; i <= STEP_RETRIES; i++) {
    try {
      return await step();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** رمز عشوائي من 6 أرقام لا يراه أحد: يُتلف الرمز المكتوب إن تعذّر تسجيل إعادة الضبط. */
function randomPin(): string {
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => n % 10).join('');
}

export interface ResetPinDeps extends AdminAuthDeps {
  /** admin_rate_hit('pin_reset', admin): يسجّل المحاولة ويرجع عدد محاولات آخر ساعة شاملة هذه */
  rateHit(adminId: string): Promise<number>;
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
    // الرمز الخام والمُطبَّع لا يدخلان أي سطر سجل (مراجعة T16-T19 L4)
    const secrets = [body.new_pin, normalizePin(body.new_pin)];
    const logErr = (msg: string, e: unknown) => deps.log?.(msg, errTextWithout(e, ...secrets));

    let target;
    try {
      target = await deps.getProfile(userId);
    } catch (e) {
      logErr('admin-reset-pin profile lookup failed', e);
      return fail(500, 'INTERNAL');
    }
    if (!target) return fail(404, 'USER_NOT_FOUND');
    // لا لحساب أدمن (ولا المستدعي نفسه): رمز الأدمن يغيّره صاحبه، أو صاحب المشروع بـ SQL.
    if (target.role === 'admin' || userId === admin) return fail(403, 'ADMIN_ACCOUNT');

    const pinError = validatePin(body.new_pin, target.phone ?? undefined);
    if (pinError) return fail(400, 'PIN_INVALID', pinError);

    let count: number;
    try {
      count = await deps.rateHit(admin);
    } catch (e) {
      logErr('admin-reset-pin rate check failed', e);
      return fail(500, 'INTERNAL');
    }
    // العدّاد يشمل هذه المحاولة؛ كل محاولة تُحسب حتى لو فشلت لاحقاً
    if (count > RESETS_PER_HOUR) return fail(429, 'TOO_MANY_RESETS');

    try {
      await deps.updatePassword(userId, normalizePin(body.new_pin));
    } catch (e) {
      logErr('admin-reset-pin update failed', e);
      return fail(500, 'INTERNAL');
    }

    // الرمز تغيّر الآن، والعلامة (must_change_pin) مسحها الـ trigger؛ record_pin_reset وحده يعيدها مع سجل التدقيق.
    // لذا: التدقيق أولاً مع إعادة المحاولة. إن فشل نهائياً نُتلف الرمز الذي كتبه الأدمن برمز عشوائي لا يعرفه
    // أحد (لا يبقى رمز حي معروف بلا علامة ولا سجل)، ونرجع RESET_INCOMPLETE فيُعاد الضبط من جديد.
    try {
      await withRetries(() => deps.recordReset(userId, admin));
    } catch (e) {
      logErr('admin-reset-pin audit failed', e);
      try {
        await deps.updatePassword(userId, randomPin());
      } catch (e2) {
        logErr('admin-reset-pin rollback failed', e2);
      }
      return fail(500, 'RESET_INCOMPLETE');
    }
    // العلامة والتدقيق ثابتان: أي فشل بعدهما لا يترك رمزاً حياً بلا علامة. إبطال الجلسات يُعاد، وإن فشل
    // نخبر الأدمن أن الضبط لم يكتمل (الأجهزة القديمة ما زالت داخلة) فلا يرسل الرمز قبل إعادة المحاولة.
    try {
      await withRetries(() => deps.revokeSessions(userId));
    } catch (e) {
      logErr('admin-reset-pin revoke failed', e);
      return fail(500, 'RESET_INCOMPLETE');
    }

    deps.log?.('admin-reset-pin done', { user_id: userId, by: admin });
    return json(200, { ok: true });
  };
}
