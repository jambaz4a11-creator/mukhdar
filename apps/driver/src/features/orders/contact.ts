// روابط الاتصال بالزبون (SPEC-driver §2.8): tel:07… وواتساب wa.me/9647…. الرقم المخزَّن 9647… أو +9647… أو 07….
import { normalizeIraqiPhone } from '@mukhdar/shared';

/** `tel:07701234567` أو null لرقم غير صالح/غائب. */
export function customerTelUrl(phone: string | null | undefined): string | null {
  const e164 = phone ? normalizeIraqiPhone(phone) : null;
  return e164 ? `tel:0${e164.slice(4)}` : null;
}

/** `https://wa.me/9647701234567` أو null. */
export function customerWhatsappUrl(phone: string | null | undefined): string | null {
  const e164 = phone ? normalizeIraqiPhone(phone) : null;
  return e164 ? `https://wa.me/${e164.slice(1)}` : null;
}
