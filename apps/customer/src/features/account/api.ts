// حسابي (T15، SPEC-customer §2.9): الاسم، تغيير رمز الدخول (ADR 0001)، روابط التواصل والخصوصية، وحذف الحساب
// عبر Edge Function delete-account ثم الخروج وتفريغ البيانات المحلية.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  authError,
  normalizeIraqiPhone,
  normalizePin,
  parseFunctionError,
  PIN_MESSAGES,
  validatePin,
  type ErrorCode,
  type MukhdarClient,
} from '@mukhdar/shared';
import type { QueryClient } from '@tanstack/react-query';
import { ar } from '../../i18n/ar';
import { useSelectedAddress } from '../addresses/selected';
import { useCart } from '../cart/store';
import { useOrderAttempt } from '../checkout/usePlaceOrder';
import { PUSH_ASKED_KEY, PUSH_TOKEN_KEY } from '../notifications/push';

export const NAME_MIN = 2;
export const NAME_MAX = 80;

export const profileKeys = {
  /** لا يُحفظ على الجهاز (shouldPersistQuery) */
  me: (userId: string | undefined) => ['profile', userId ?? 'anon'] as const,
};

/** "  أحمد   علي " ← "أحمد علي" */
export function cleanName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

export async function updateFullName(
  client: MukhdarClient,
  userId: string,
  name: string,
): Promise<void> {
  const { error } = await client
    .from('profiles')
    .update({ full_name: cleanName(name) })
    .eq('id', userId);
  if (error) throw error;
}

// ------------------------------------------------------------------ الروابط

/** واتساب المتجر (wa.me). null إن لم يُضبط الرقم أو كان غير صالح. */
export function whatsappUrl(shopNumber: string): string | null {
  const shop = shopNumber.replace(/[\s+\-()]/g, '');
  return /^\d{8,15}$/.test(shop) ? `https://wa.me/${shop}` : null;
}

/** tel: لرقم المتجر. رقم عراقي (07… / 9647… / +9647…) يصير +9647…؛ أرضي أو غيره يُقبل كأرقام 7..15. */
export function telUrl(phone: string): string | null {
  const raw = phone.replace(/[\s\-()]/g, '');
  if (raw === '') return null;
  const iraqi = normalizeIraqiPhone(raw);
  if (iraqi) return `tel:${iraqi}`;
  return /^\+?\d{7,15}$/.test(raw) ? `tel:${raw}` : null;
}

/** رابط صفحة عامة: https فقط. */
export function httpsUrl(url: string): string | null {
  try {
    return url !== '' && new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ تغيير الرمز

export type ChangePinResult =
  { ok: true } | { ok: false; field: 'current' | 'next'; message: string };

/**
 * ADR 0001: الرمز الحالي يُتحقق منه بـ signInWithPassword بنفس الرقم، ثم الجديد (مرتين) ← validatePin ←
 * updateUser بأرقام لاتينية. يرجع الخطأ مع الحقل المعني لعرضه.
 */
export async function changePin(
  client: MukhdarClient,
  phone: string,
  current: string,
  next: string,
  confirm: string,
): Promise<ChangePinResult> {
  const nextPin = normalizePin(next);
  const invalid = validatePin(nextPin, phone);
  if (invalid) return { ok: false, field: 'next', message: PIN_MESSAGES[invalid] };
  if (nextPin !== normalizePin(confirm)) {
    return { ok: false, field: 'next', message: ar.auth.pinMismatch };
  }
  const currentPin = normalizePin(current);
  if (nextPin === currentPin) return { ok: false, field: 'next', message: ar.account.pinSame };
  const e164 = normalizeIraqiPhone(phone);
  if (!e164) return { ok: false, field: 'current', message: ar.account.pinFailed };

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
        message: e.kind === 'invalid_credentials' ? ar.account.pinWrongCurrent : e.message,
      };
    }
    const { error } = await client.auth.updateUser({ password: nextPin });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === 'same_password') {
        return { ok: false, field: 'next', message: ar.account.pinSame };
      }
      return { ok: false, field: 'next', message: authError(error).message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, field: 'next', message: authError(e).message };
  }
}

// ------------------------------------------------------------------ حذف الحساب

/** مفاتيح AsyncStorage الخاصة بالمستخدم (تُمسح بعد حذف الحساب). */
export const LOCAL_DATA_KEYS = [
  'mukhdar.cart',
  'mukhdar.orderAttempt',
  'mukhdar.deliveryAddress',
  'mukhdar.queryCache',
  PUSH_TOKEN_KEY,
  PUSH_ASKED_KEY,
] as const;

/** يفرّغ السلة ومفتاح الطلب والعنوان المختار والكاش (بالذاكرة وعلى الجهاز) ورمز الإشعارات المحلي. */
export async function clearLocalData(queryClient: QueryClient): Promise<void> {
  useCart.getState().clear();
  useOrderAttempt.getState().reset();
  useSelectedAddress.getState().select(null);
  queryClient.clear();
  // بعد تفريغ المخازن (persist يكتبها فارغة)، ثم المسح الكامل للمفاتيح
  await AsyncStorage.multiRemove([...LOCAL_DATA_KEYS]);
}

export type DeleteResult = { ok: true } | { ok: false; code: ErrorCode | null; message: string };

/**
 * delete-account (POST بجلسة المستخدم): نجاح ← تفريغ البيانات المحلية وإنهاء الجلسة محلياً (المستخدم حُذف،
 * فلا داعي لطلب خروج من الخادم). ACTIVE_ORDER وغيره ← رسالة عربية من parseFunctionError.
 */
export async function deleteAccount(
  client: MukhdarClient,
  queryClient: QueryClient,
): Promise<DeleteResult> {
  try {
    const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      const parsed = await parseFunctionError(error);
      return { ok: false, code: parsed.code, message: parsed.message };
    }
  } catch (e) {
    const parsed = await parseFunctionError(e);
    return { ok: false, code: parsed.code, message: parsed.message };
  }
  await clearLocalData(queryClient);
  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // الجلسة المحلية تُمسح على أي حال عند الفشل التالي؛ لا يمنع إكمال الحذف
  }
  return { ok: true };
}
