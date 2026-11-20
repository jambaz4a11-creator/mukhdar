// إرسال طلب التسجيل (SPEC-driver §2.3، DRIVER-API "Self-registration"). لا حساب يُنشأ هنا.
// الترتيب: فحص الاسم والرقم بالتطبيق ← سر الجهاز يُحفظ بـ SecureStore ← إذن الإشعارات (اختياري) ←
// driver-register ← حفظ request_id. لا يُطبع الجسم ولا السر.
import {
  ERROR_MESSAGES,
  normalizeIraqiPhone,
  parseFunctionError,
  type MukhdarClient,
} from '@mukhdar/shared';
import { ar } from '../../i18n/ar';
import { getExpoPushTokenIfAllowed } from '../../lib/push';
import { saveRegistration } from '../../lib/secureStore';
import { getOrCreateDeviceSecret } from './deviceSecret';

export const NAME_MIN = 2;
export const NAME_MAX = 80;

/** "  علي   حسين " ← "علي حسين" */
export function cleanName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

export function isValidName(name: string): boolean {
  const length = [...cleanName(name)].length;
  return length >= NAME_MIN && length <= NAME_MAX;
}

export type RegisterResult = { ok: true } | { ok: false; message: string };

export async function submitRegistration(
  client: MukhdarClient,
  input: { fullName: string; phone: string },
  deps: { getPushToken?: () => Promise<string | null> } = {},
): Promise<RegisterResult> {
  const fullName = cleanName(input.fullName);
  if (!isValidName(fullName)) return { ok: false, message: ERROR_MESSAGES.NAME_INVALID };
  const phone = normalizeIraqiPhone(input.phone);
  if (!phone) return { ok: false, message: ERROR_MESSAGES.PHONE_INVALID };

  let secret: string;
  try {
    secret = await getOrCreateDeviceSecret();
  } catch {
    return { ok: false, message: ERROR_MESSAGES.REGISTER_FAILED };
  }
  const pushToken = await (deps.getPushToken ?? getExpoPushTokenIfAllowed)();

  try {
    const { data, error } = await client.functions.invoke('driver-register', {
      body: {
        full_name: fullName,
        phone,
        device_secret: secret,
        ...(pushToken ? { push_token: pushToken } : {}),
      },
    });
    if (error) {
      const parsed = await parseFunctionError(error);
      // بسياق التسجيل: الرقم له حساب (زبون مثلاً) ← المحل يرقّيه، لا "سجّل الدخول"
      return {
        ok: false,
        message: parsed.code === 'PHONE_TAKEN' ? ar.register.phoneTaken : parsed.message,
      };
    }
    const requestId = (data as { request_id?: unknown } | null)?.request_id;
    if (typeof requestId !== 'string' || requestId === '') {
      return { ok: false, message: ERROR_MESSAGES.REGISTER_FAILED };
    }
    await saveRegistration({ requestId, fullName, phone });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (await parseFunctionError(e)).message };
  }
}
