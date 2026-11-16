// رمز PIN للدخول (ADR 0001): 6 أرقام بالضبط، بلا رموز سهلة التخمين. يُرسل لـ Supabase Auth ككلمة سر.
// الخادم لا يرى الـ PIN (GoTrue يخزن bcrypt فقط)، فهذا الفحص بالتطبيقات قبل التسجيل وتغيير الـ PIN
// وإعادة ضبطه من الأدمن. الحد الأدنى بالخادم: minimum_password_length = 6.

import { normalizeIraqiPhone } from './phone';

export const PIN_LENGTH = 6;

export type PinError = 'PIN_LENGTH' | 'PIN_TRIVIAL' | 'PIN_MATCHES_PHONE';

export const PIN_MESSAGES: Record<PinError, string> = {
  PIN_LENGTH: 'الرمز لازم يكون 6 أرقام',
  PIN_TRIVIAL: 'هذا الرمز سهل التخمين، اختر رمزاً آخر (بلا تكرار أو تسلسل)',
  PIN_MATCHES_PHONE: 'لا تستخدم أرقاماً من رقم هاتفك كرمز',
};

/** رموز شائعة لا يكشفها نمط (أنماط لوحة الأرقام، أزواج متصاعدة...). */
const COMMON_PINS = new Set([
  '112233',
  '123321',
  '159753',
  '159357',
  '147258',
  '147852',
  '258369',
  '369258',
  '789456',
  '456123',
  '852456',
  '741852',
  '963852',
  '102030',
  '010203',
  '111222',
  '000111',
  '123654',
  '654123',
  '121314',
  '131313',
  '202020',
  '200000',
  '100000',
  '999000',
]);

/**
 * يحوّل الأرقام العربية-الهندية (٠-٩ و ۰-۹) إلى لاتينية ويحذف المسافات.
 * **إلزامي** قبل signUp وsignInWithPassword وتغيير الـ PIN: نفس الرمز بأي لوحة مفاتيح = نفس كلمة السر.
 */
export function normalizePin(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s/g, '');
}

/** تكرار بدورة 1 أو 2 أو 3 (000000، 121212، 123123)، أو تسلسل بخطوة ±1 (123456، 987654، 345678). */
function isPatterned(pin: string): boolean {
  for (const period of [1, 2, 3]) {
    if ([...pin].every((c, i) => c === pin[i % period])) return true;
  }
  const d = [...pin].map(Number);
  for (const step of [1, -1]) {
    if (d.every((x, i) => i === 0 || x - (d[i - 1] as number) === step)) return true;
  }
  return false;
}

/** true للرموز السهلة: نمط (تكرار، تسلسل) أو رمز شائع. pin بعد normalizePin. */
export function isTrivialPin(pin: string): boolean {
  return isPatterned(pin) || COMMON_PINS.has(pin);
}

/**
 * يفحص الـ PIN (بعد normalizePin). phone اختياري (أي صيغة): يُرفض الرمز إن كان آخر 6 أرقام منه
 * أو أول 6 أرقام وطنية (770123 من 07701234567).
 * يرجع null إن كان مقبولاً، وإلا رمز الخطأ (رسالته بـ PIN_MESSAGES).
 */
export function validatePin(input: string, phone?: string): PinError | null {
  const pin = normalizePin(input);
  if (!new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin)) return 'PIN_LENGTH';
  if (isTrivialPin(pin)) return 'PIN_TRIVIAL';
  if (phone) {
    const digits = normalizePin(phone).replace(/\D/g, '');
    const national = /(7\d{9})$/.exec(digits)?.[1];
    if (digits.endsWith(pin) || (national && national.startsWith(pin))) return 'PIN_MATCHES_PHONE';
  }
  return null;
}

/**
 * رمز عشوائي من 6 أرقام يمر بـ validatePin (لإعادة الضبط وإنشاء الحسابات من لوحة الأدمن).
 * crypto.getRandomValues (متصفح، Node ≥ 19، Deno)؛ random للاختبار فقط.
 */
export function generatePin(phone?: string, random?: () => number): string {
  const next = random ?? (() => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32);
  for (let attempt = 0; attempt < 1000; attempt++) {
    let pin = '';
    for (let i = 0; i < PIN_LENGTH; i++) pin += String(Math.floor(next() * 10) % 10);
    if (validatePin(pin, phone) === null) return pin;
  }
  throw new Error('generatePin: no acceptable PIN');
}

/** رسالة واتساب جاهزة للرمز (wa.me برقم دولي بلا "+")؛ phone بأي صيغة. null لرقم غير صالح. */
export function whatsappPinLink(phone: string, text: string): string | null {
  const e164 = normalizeIraqiPhone(phone);
  return e164 ? `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(text)}` : null;
}

export interface PhonePinCredentials {
  /** E.164: +9647XXXXXXXXX (Supabase يخزنه 9647XXXXXXXXX) */
  phone: string;
  /** الـ PIN بأرقام لاتينية */
  password: string;
}

/**
 * بيانات signUp / signInWithPassword من مدخلات المستخدم:
 * `supabase.auth.signInWithPassword(phonePinCredentials('0770 123 4567', '٤٨٢٩١٥'))`.
 * null إن كان الرقم غير صالح أو الـ PIN ليس 6 أرقام. لا يفحص السهولة (الدخول بحساب قديم يجب أن يعمل):
 * استخدم validatePin عند التسجيل وتغيير الرمز.
 */
export function phonePinCredentials(
  phoneInput: string,
  pinInput: string,
): PhonePinCredentials | null {
  const phone = normalizeIraqiPhone(phoneInput);
  const pin = normalizePin(pinInput);
  if (!phone || !new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin)) return null;
  return { phone, password: pin };
}
