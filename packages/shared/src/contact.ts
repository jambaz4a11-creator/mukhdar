// روابط التواصل مع المحل وعرض الرقم (نُقلت من تطبيق الزبون بـ T30 حتى يستعملها تطبيق السائق بلا تكرار).
import { normalizeIraqiPhone } from './phone';

const shopDigits = (shopNumber: string): string | null => {
  const shop = shopNumber.replace(/[\s+\-()]/g, '');
  return /^\d{8,15}$/.test(shop) ? shop : null;
};

/** واتساب المحل (wa.me). null إن لم يُضبط الرقم أو كان غير صالح. */
export function whatsappUrl(shopNumber: string): string | null {
  const shop = shopDigits(shopNumber);
  return shop ? `https://wa.me/${shop}` : null;
}

/** tel: لرقم المحل. رقم عراقي (07… / 9647… / +9647…) يصير +9647…؛ أرضي أو غيره يُقبل كأرقام 7..15. */
export function telUrl(phone: string): string | null {
  const raw = phone.replace(/[\s\-()]/g, '');
  if (raw === '') return null;
  const iraqi = normalizeIraqiPhone(raw);
  if (iraqi) return `tel:${iraqi}`;
  return /^\+?\d{7,15}$/.test(raw) ? `tel:${raw}` : null;
}

/** "نسيت الرمز؟": رابط wa.me برسالة جاهزة فيها رقم المستخدم. null إن لم يُضبط رقم المحل. */
export function forgotPinWhatsappUrl(shopNumber: string, phoneInput: string): string | null {
  const shop = shopDigits(shopNumber);
  if (!shop) return null;
  const e164 = normalizeIraqiPhone(phoneInput);
  const text = e164 ? `نسيت رمز الدخول، رقمي 0${e164.slice(4)}` : 'نسيت رمز الدخول';
  return `https://wa.me/${shop}?text=${encodeURIComponent(text)}`;
}

/** 9647701234567 / +9647701234567 ← 07701234567 للعرض. */
export function displayPhone(stored: string | null | undefined): string {
  const e164 = stored ? normalizeIraqiPhone(stored) : null;
  return e164 ? `0${e164.slice(4)}` : '';
}
