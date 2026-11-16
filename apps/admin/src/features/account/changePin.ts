// تغيير رمز الدخول باللوحة (SPEC-admin §2.6، ADR 0001): نفس مسار تطبيق الزبون.
// 1) الجديد (مرتين) ← validatePin برقم الشخص، ولا يساوي الحالي (الرمز المؤقت لا يُعاد).
// 2) signInWithPassword بالرقم والرمز الحالي: تحقق + جلسة جديدة (فلا يُطلب reauthenticate عبر SMS المرفوض).
// 3) updateUser ← قاعدة البيانات تمسح must_change_pin بنفسها (trigger على كلمة السر).
// 4) signOut({ scope: 'others' }): بقية الأجهزة تخرج. فشله لا يلغي التغيير.
import {
  PIN_MESSAGES,
  authError,
  normalizeIraqiPhone,
  normalizePin,
  validatePin,
  type MukhdarClient,
} from '@mukhdar/shared';

export type ChangePinResult =
  | { ok: true; othersSignedOut: boolean }
  | { ok: false; field: 'current' | 'next'; message: string };

export const CHANGE_PIN_TEXT = {
  mismatch: 'الرمزان الجديدان غير متطابقين',
  same: 'الرمز الجديد نفس الحالي، اختر رمزاً مختلفاً',
  wrongCurrent: 'الرمز الحالي غير صحيح',
  noPhone: 'تعذّر قراءة رقم حسابك، سجّل الخروج وادخل مرة ثانية',
} as const;

type AuthClient = Pick<MukhdarClient, 'auth'>;

export async function changePanelPin(
  client: AuthClient,
  phone: string | null,
  current: string,
  next: string,
  confirm: string,
): Promise<ChangePinResult> {
  const e164 = phone ? normalizeIraqiPhone(phone) : null;
  if (!e164) return { ok: false, field: 'current', message: CHANGE_PIN_TEXT.noPhone };
  const nextPin = normalizePin(next);
  const invalid = validatePin(nextPin, phone ?? undefined);
  if (invalid) return { ok: false, field: 'next', message: PIN_MESSAGES[invalid] };
  if (nextPin !== normalizePin(confirm)) {
    return { ok: false, field: 'next', message: CHANGE_PIN_TEXT.mismatch };
  }
  const currentPin = normalizePin(current);
  if (nextPin === currentPin) return { ok: false, field: 'next', message: CHANGE_PIN_TEXT.same };

  try {
    const signIn = await client.auth.signInWithPassword({ phone: e164, password: currentPin });
    if (signIn.error) {
      const e = authError(signIn.error);
      return {
        ok: false,
        field: 'current',
        message: e.kind === 'invalid_credentials' ? CHANGE_PIN_TEXT.wrongCurrent : e.message,
      };
    }
    const { error } = await client.auth.updateUser({ password: nextPin });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === 'same_password')
        return { ok: false, field: 'next', message: CHANGE_PIN_TEXT.same };
      return { ok: false, field: 'next', message: authError(error).message };
    }
    const { error: othersError } = await client.auth.signOut({ scope: 'others' });
    return { ok: true, othersSignedOut: !othersError };
  } catch (e) {
    return { ok: false, field: 'next', message: authError(e).message };
  }
}
