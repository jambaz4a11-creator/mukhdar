// اختيار الرمز بعد الموافقة (SPEC-driver §2.5، DRIVER-API "Self-registration" 3).
// validatePin + التطابق بالتطبيق ← driver-complete-registration (ينشئ حساب سائق فعّال بلا must_change_pin) ←
// signInWithPassword بنفس الرقم والرمز ← مسح request_id وسر الجهاز. الرمز لا يُرسل لأي مكان غير الدالة ثم GoTrue.
import {
  ERROR_MESSAGES,
  normalizePin,
  parseFunctionError,
  PIN_MESSAGES,
  validatePin,
  type MukhdarClient,
  type PinError,
} from '@mukhdar/shared';
import { ar } from '../../i18n/ar';
import type { Registration } from '../../lib/secureStore';
import { fetchRequestStatus, pendingOutcome } from './pendingPoll';
import { forgetRegistration } from './store';

/** next: وين تروح الشاشة (login بإشعار "حسابك جاهز"، pending يعرض القرار، register بعد مسح الجهاز). */
export type SetPinResult =
  | { ok: true }
  | { ok: false; message: string }
  | { ok: false; next: 'login' | 'pending' | 'register' };

const isPinError = (v: string | null): v is PinError =>
  v !== null && Object.prototype.hasOwnProperty.call(PIN_MESSAGES, v);

export async function completeRegistration(
  client: MukhdarClient,
  reg: Registration,
  pinInput: string,
  confirmInput: string,
): Promise<SetPinResult> {
  const pin = normalizePin(pinInput);
  const invalid = validatePin(pin, reg.phone);
  if (invalid) return { ok: false, message: PIN_MESSAGES[invalid] };
  if (pin !== normalizePin(confirmInput)) return { ok: false, message: ar.setPin.mismatch };

  try {
    const { error } = await client.functions.invoke('driver-complete-registration', {
      body: { request_id: reg.requestId, device_secret: reg.secret, pin },
    });
    if (error) {
      const parsed = await parseFunctionError(error);
      switch (parsed.code) {
        case 'PIN_INVALID':
          return {
            ok: false,
            message: isPinError(parsed.detail) ? PIN_MESSAGES[parsed.detail] : parsed.message,
          };
        case 'PHONE_TAKEN':
        case 'REQUEST_NOT_APPROVED':
          return await recheck(client, reg, parsed.code);
        case 'REQUEST_EXPIRED':
          return { ok: false, next: 'pending' };
        case 'REQUEST_NOT_FOUND':
          await forgetRegistration();
          return { ok: false, next: 'register' };
        default:
          return { ok: false, message: parsed.message };
      }
    }
  } catch (e) {
    return { ok: false, message: (await parseFunctionError(e)).message };
  }

  // الحساب أُنشئ: من هنا الطلب لم يعد يلزم الجهاز
  let signedIn: boolean;
  try {
    const { data, error } = await client.auth.signInWithPassword({
      phone: reg.phone,
      password: pin,
    });
    signedIn = !error && data.session !== null;
  } catch {
    signedIn = false;
  }
  await forgetRegistration();
  return signedIn ? { ok: true } : { ok: false, next: 'login' };
}

/** PHONE_TAKEN / REQUEST_NOT_APPROVED: الحالة على الخادم تقرر (SPEC-driver §2.5). */
async function recheck(
  client: MukhdarClient,
  reg: Registration,
  code: 'PHONE_TAKEN' | 'REQUEST_NOT_APPROVED',
): Promise<SetPinResult> {
  let outcome;
  try {
    outcome = pendingOutcome(await fetchRequestStatus(client, reg));
  } catch (e) {
    return { ok: false, message: (await parseFunctionError(e)).message };
  }
  if (outcome === 'login') {
    await forgetRegistration();
    return { ok: false, next: 'login' };
  }
  if (outcome === 'register') {
    await forgetRegistration();
    return { ok: false, next: 'register' };
  }
  // ما زال approved: الرقم صار له حساب (الأدمن يرقّيه) أو سباق نادر
  if (outcome === 'set-pin') {
    return {
      ok: false,
      message:
        code === 'PHONE_TAKEN' ? ar.register.phoneTaken : ERROR_MESSAGES.REQUEST_NOT_APPROVED,
    };
  }
  return { ok: false, next: 'pending' };
}
