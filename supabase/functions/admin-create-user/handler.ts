// معالج admin-create-user (T19، SPEC-admin §2.6): الأدمن ينشئ حساب موظف أو سائق برمز مؤقت.
// بلا اعتماديات خارجية (يُختبر مباشرة).
//
// الطلب:  POST {"phone": "07…", "full_name": "…", "role": "staff" | "driver", "pin": "######"}
//         Authorization: Bearer <JWT الأدمن>
// الرد:   201 {"user_id": "…"}، أو {"error": CODE[, "detail"]}:
//         401 NOT_AUTHENTICATED | 403 NOT_ALLOWED | 403 PIN_CHANGE_REQUIRED (المستدعي برمز مؤقت) |
//         400 INVALID_REQUEST | 400 PHONE_INVALID |
//         400 INVALID_ROLE | 400 PIN_INVALID (detail) | 429 RATE_LIMITED | 409 PHONE_TAKEN | 500 INTERNAL
// فشل بعد إنشاء الحساب ← حذفه ثم 500. الرمز لا يرجع ولا يُسجَّل.
import { normalizeIraqiPhone, toStoredPhone } from '../../../packages/shared/src/phone.ts';
import { normalizePin, validatePin } from '../../../packages/shared/src/pin.ts';
import {
  type AdminAuthDeps,
  errTextWithout,
  fail,
  json,
  readJsonObject,
  requireAdmin,
} from '../_shared/admin.ts';
import { withCors } from '../_shared/cors.ts';

export const CREATIONS_PER_HOUR = 20;
export type CreatableRole = 'staff' | 'driver';

export interface CreateUserDeps extends AdminAuthDeps {
  /** admin_rate_hit('user_creation', admin): يسجّل المحاولة ويرجع عدد محاولات آخر ساعة شاملة هذه */
  rateHit(adminId: string): Promise<number>;
  /** auth.admin.createUser({ phone, password, phone_confirm: true }): المعرّف، أو 'exists'. */
  createUser(phone: string, pin: string): Promise<{ id: string } | 'exists'>;
  /** finish_user_creation: الاسم والدور وسجل user_creations بمعاملة واحدة. */
  finish(userId: string, adminId: string, role: CreatableRole, fullName: string): Promise<void>;
  /** auth.admin.deleteUser: تنظيف إن فشل ما بعد الإنشاء. */
  deleteUser(userId: string): Promise<void>;
  log?: (msg: string, extra?: unknown) => void;
}

export function createAdminCreateUserHandler(
  deps: CreateUserDeps,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return fail(405, 'INVALID_REQUEST');

    const admin = await requireAdmin(req, deps);
    if (admin instanceof Response) return admin;

    const body = await readJsonObject(req);
    if (
      !body ||
      typeof body.phone !== 'string' ||
      typeof body.pin !== 'string' ||
      typeof body.role !== 'string' ||
      typeof body.full_name !== 'string'
    ) {
      return fail(400, 'INVALID_REQUEST');
    }
    const e164 = normalizeIraqiPhone(body.phone);
    if (!e164) return fail(400, 'PHONE_INVALID');
    const phone = toStoredPhone(e164);
    if (body.role !== 'staff' && body.role !== 'driver') return fail(400, 'INVALID_ROLE');
    const role: CreatableRole = body.role;
    const fullName = body.full_name.trim();
    if (fullName.length < 1 || fullName.length > 80) return fail(400, 'INVALID_REQUEST');
    const pinError = validatePin(body.pin, phone);
    if (pinError) return fail(400, 'PIN_INVALID', pinError);
    // الرمز الخام والمُطبَّع لا يدخلان أي سطر سجل (مراجعة T16-T19 L4)
    const secrets = [body.pin, normalizePin(body.pin)];
    const logErr = (msg: string, e: unknown) => deps.log?.(msg, errTextWithout(e, ...secrets));

    let count: number;
    try {
      count = await deps.rateHit(admin);
    } catch (e) {
      logErr('admin-create-user rate check failed', e);
      return fail(500, 'INTERNAL');
    }
    // العدّاد يشمل هذه المحاولة؛ كل محاولة تُحسب (ومنها 409 PHONE_TAKEN: لا استكشاف أرقام بلا حد)
    if (count > CREATIONS_PER_HOUR) return fail(429, 'RATE_LIMITED');

    let created: { id: string } | 'exists';
    try {
      created = await deps.createUser(phone, normalizePin(body.pin));
    } catch (e) {
      logErr('admin-create-user createUser failed', e);
      return fail(500, 'INTERNAL');
    }
    if (created === 'exists') return fail(409, 'PHONE_TAKEN');

    try {
      await deps.finish(created.id, admin, role, fullName);
    } catch (e) {
      logErr('admin-create-user finish failed', e);
      await deps
        .deleteUser(created.id)
        .catch((err) => logErr('admin-create-user cleanup failed', err));
      return fail(500, 'INTERNAL');
    }

    deps.log?.('admin-create-user done', { user_id: created.id, role, by: admin });
    return json(201, { user_id: created.id });
  };
}

/** ما تخدمه index.ts: المعالج + CORS (OPTIONS والترويسات) بأصول ALLOWED_ORIGINS فقط (T23 H1). */
export function createAdminCreateUserServer(
  deps: CreateUserDeps,
  allowedOrigins: ReadonlySet<string>,
): (req: Request) => Promise<Response> {
  return withCors(createAdminCreateUserHandler(deps), allowedOrigins);
}
