// حسابي (T15، SPEC-customer §2.9): الاسم، تغيير رمز الدخول (ADR 0001)، روابط التواصل والخصوصية، وحذف الحساب
// عبر Edge Function delete-account ثم الخروج وتفريغ البيانات المحلية.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  changePin as sharedChangePin,
  parseFunctionError,
  type ChangePinResult,
  type ErrorCode,
  type MukhdarClient,
} from '@mukhdar/shared';
import type { QueryClient } from '@tanstack/react-query';
import { captureError } from '../../lib/sentry';
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

// whatsappUrl وtelUrl من @mukhdar/shared (T30: مشتركة مع تطبيق السائق)
export { telUrl, whatsappUrl } from '@mukhdar/shared';

/** رابط صفحة عامة: https فقط. */
export function httpsUrl(url: string): string | null {
  try {
    return url !== '' && new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ تغيير الرمز

export type { ChangePinResult } from '@mukhdar/shared';

/** ADR 0001: changePin من @mukhdar/shared (T30)؛ فشل إبطال الجلسات الأخرى يُرسل لـ Sentry فقط. */
export function changePin(
  client: MukhdarClient,
  phone: string,
  current: string,
  next: string,
  confirm: string,
): Promise<ChangePinResult> {
  return sharedChangePin(client, phone, current, next, confirm, { onRevokeError: captureError });
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
