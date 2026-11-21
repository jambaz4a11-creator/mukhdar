// الويب (PWA السائق، يُربط بـ T37/W4): طلب التسجيل المحفوظ بالجهاز (SPEC-driver §2.3–§2.5) بنفس واجهة
// secureStore.ts، فوق التخزين المشفَّر (secureStorage.web.ts، T34). على iOS يُنشأ داخل الـ PWA المثبَّت فقط
// (تخزينه منفصل عن Safari، SPEC-webpush §3.2). السر لا يُطبع ولا يُخزَّن نصاً صريحاً.
import type { Registration } from './secureStore';
import { secureStorage } from './secureStorage.web';

export type { Registration };

const KEYS = {
  secret: 'mukhdar.driver.reg.secret',
  requestId: 'mukhdar.driver.reg.request_id',
  fullName: 'mukhdar.driver.reg.full_name',
  phone: 'mukhdar.driver.reg.phone',
} as const;

export function readSecret(): Promise<string | null> {
  return secureStorage.getItem(KEYS.secret);
}

/** يُحفظ **قبل** إرسال الطلب (SPEC-driver §2.3). */
export function saveSecret(secret: string): Promise<void> {
  return secureStorage.setItem(KEYS.secret, secret);
}

/** بعد 201 من driver-register. */
export async function saveRegistration(r: Omit<Registration, 'secret'>): Promise<void> {
  await secureStorage.setItem(KEYS.fullName, r.fullName);
  await secureStorage.setItem(KEYS.phone, r.phone);
  // request_id آخراً: وجوده = الطلب محفوظ كاملاً
  await secureStorage.setItem(KEYS.requestId, r.requestId);
}

/** الطلب المحفوظ، أو null إن نقص request_id أو السر. */
export async function loadRegistration(): Promise<Registration | null> {
  const [requestId, secret, fullName, phone] = await Promise.all([
    secureStorage.getItem(KEYS.requestId),
    secureStorage.getItem(KEYS.secret),
    secureStorage.getItem(KEYS.fullName),
    secureStorage.getItem(KEYS.phone),
  ]);
  if (!requestId || !secret) return null;
  return { requestId, secret, fullName: fullName ?? '', phone: phone ?? '' };
}

/** يمسح كل شيء (السر معه): "طلب جديد"، "إلغاء"، أو بعد اكتمال الحساب. */
export async function clearRegistration(): Promise<void> {
  for (const key of Object.values(KEYS)) await secureStorage.removeItem(key);
}
