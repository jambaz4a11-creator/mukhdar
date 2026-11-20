// طلب التسجيل المحفوظ بالجهاز (SPEC-driver §2.3–§2.5): request_id وسر الجهاز والاسم والرقم.
// expo-secure-store فقط (Keychain / Keystore)، وبوصول "هذا الجهاز فقط": لا يُنقل لجهاز آخر بنسخة احتياطية،
// فجهاز آخر لا يقدر يكمل الطلب. السر لا يُطبع، ويُرسل فقط لـ driver-register وdriver-complete-registration
// وRPC driver_request_status (الخادم يقارن SHA-256 فقط، SPEC-driver §3).
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  secret: 'mukhdar.driver.reg.secret',
  requestId: 'mukhdar.driver.reg.request_id',
  fullName: 'mukhdar.driver.reg.full_name',
  phone: 'mukhdar.driver.reg.phone',
} as const;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface Registration {
  requestId: string;
  /** سر الجهاز (base64url، 43 حرفاً) */
  secret: string;
  fullName: string;
  /** E.164 (+9647...) */
  phone: string;
}

const read = (key: string) => SecureStore.getItemAsync(key, OPTIONS);

export function readSecret(): Promise<string | null> {
  return read(KEYS.secret);
}

/** يُحفظ **قبل** إرسال الطلب (SPEC-driver §2.3). */
export function saveSecret(secret: string): Promise<void> {
  return SecureStore.setItemAsync(KEYS.secret, secret, OPTIONS);
}

/** بعد 201 من driver-register. */
export async function saveRegistration(r: Omit<Registration, 'secret'>): Promise<void> {
  await SecureStore.setItemAsync(KEYS.fullName, r.fullName, OPTIONS);
  await SecureStore.setItemAsync(KEYS.phone, r.phone, OPTIONS);
  // request_id آخراً: وجوده = الطلب محفوظ كاملاً
  await SecureStore.setItemAsync(KEYS.requestId, r.requestId, OPTIONS);
}

/** الطلب المحفوظ، أو null إن نقص request_id أو السر. */
export async function loadRegistration(): Promise<Registration | null> {
  const [requestId, secret, fullName, phone] = await Promise.all([
    read(KEYS.requestId),
    read(KEYS.secret),
    read(KEYS.fullName),
    read(KEYS.phone),
  ]);
  if (!requestId || !secret) return null;
  return { requestId, secret, fullName: fullName ?? '', phone: phone ?? '' };
}

/** يمسح كل شيء (السر معه): "طلب جديد"، "إلغاء"، أو بعد اكتمال الحساب. */
export async function clearRegistration(): Promise<void> {
  for (const key of Object.values(KEYS)) await SecureStore.deleteItemAsync(key, OPTIONS);
}
