// تغيير رمز الدخول (ADR 0001؛ نُقل من تطبيق الزبون بـ T30 ليستعمله تطبيق السائق بالتغيير الإجباري وحسابي).
// الرمز الحالي يُتحقق منه بـ signInWithPassword بنفس الرقم، ثم الجديد (مرتين) ← validatePin ← updateUser بأرقام
// لاتينية ← إبطال الجلسات الأخرى. الدخول أولاً شرط: جلسة جديدة فلا يطلب Supabase إعادة تحقق (عبر SMS المرفوض).
// تغيير كلمة السر لا يبطل الجلسات الأخرى بنفسه (فُحص على mukhdar-dev)، فيُطلب signOut({ scope: 'others' }).
// رمز مؤقت من الأدمن: قاعدة البيانات تمسح profiles.must_change_pin بنفسها عند تغيير كلمة السر.
import { authError } from './auth-errors';
import { normalizeIraqiPhone } from './phone';
import { normalizePin, PIN_MESSAGES, validatePin } from './pin';

export const PIN_CHANGE_MESSAGES = {
  mismatch: 'الرمزان غير متطابقين',
  wrongCurrent: 'الرمز الحالي غير صحيح',
  same: 'الرمز الجديد نفس الحالي، اختر رمزاً مختلفاً',
  failed: 'تعذّر تغيير الرمز، حاول مرة ثانية',
} as const;

/** الجزء الذي نحتاجه من supabase.auth (يسهّل الاختبار بلا client كامل). */
export interface PinChangeClient {
  auth: {
    signInWithPassword(creds: { phone: string; password: string }): PromiseLike<{ error: unknown }>;
    updateUser(attrs: { password: string }): PromiseLike<{ error: unknown }>;
    signOut(options: { scope: 'others' }): PromiseLike<{ error: unknown }>;
  };
}

export type ChangePinResult =
  { ok: true } | { ok: false; field: 'current' | 'next'; message: string };

export async function changePin(
  client: PinChangeClient,
  phone: string,
  current: string,
  next: string,
  confirm: string,
  { onRevokeError }: { onRevokeError?: (error: unknown) => void } = {},
): Promise<ChangePinResult> {
  const nextPin = normalizePin(next);
  const invalid = validatePin(nextPin, phone);
  if (invalid) return { ok: false, field: 'next', message: PIN_MESSAGES[invalid] };
  if (nextPin !== normalizePin(confirm)) {
    return { ok: false, field: 'next', message: PIN_CHANGE_MESSAGES.mismatch };
  }
  const currentPin = normalizePin(current);
  if (nextPin === currentPin) return { ok: false, field: 'next', message: PIN_CHANGE_MESSAGES.same };
  const e164 = normalizeIraqiPhone(phone);
  if (!e164) return { ok: false, field: 'current', message: PIN_CHANGE_MESSAGES.failed };

  try {
    const { error: signInError } = await client.auth.signInWithPassword({
      phone: e164,
      password: currentPin,
    });
    if (signInError) {
      const e = authError(signInError);
      return {
        ok: false,
        field: 'current',
        message: e.kind === 'invalid_credentials' ? PIN_CHANGE_MESSAGES.wrongCurrent : e.message,
      };
    }
    const { error } = await client.auth.updateUser({ password: nextPin });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === 'same_password') {
        return { ok: false, field: 'next', message: PIN_CHANGE_MESSAGES.same };
      }
      return { ok: false, field: 'next', message: authError(error).message };
    }
    // من يغيّر رمزه لأنه يشك بجلسة مسروقة: تُبطل كل الجلسات الأخرى (تبقى جلسة هذا الجهاز).
    // فشلها لا يُلغي تغيير الرمز (تمّ فعلاً)، فيُبلَّغ فقط.
    const { error: revokeError } = await client.auth.signOut({ scope: 'others' });
    if (revokeError) onRevokeError?.(revokeError);
    return { ok: true };
  } catch (e) {
    return { ok: false, field: 'next', message: authError(e).message };
  }
}
