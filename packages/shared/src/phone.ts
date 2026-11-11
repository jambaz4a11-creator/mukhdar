// أرقام الموبايل العراقية: 10 أرقام وطنية تبدأ بـ 7 (مثل 7701234567)، وبصيغة E.164: +9647701234567.

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** يحوّل الأرقام العربية-الهندية (٠-٩ و ۰-۹) إلى لاتينية. */
function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_INDIC.indexOf(d);
    return String(i >= 0 ? i : EXTENDED_ARABIC_INDIC.indexOf(d));
  });
}

/**
 * يقبل: 07701234567، 7701234567، +9647701234567، 009647701234567، 9647701234567،
 * مع مسافات أو شرطات أو أقواس، وبأرقام لاتينية أو عربية.
 * يرجع "+9647XXXXXXXXX"، أو null لأي رقم غير صالح (أقصر، أطول، لا يبدأ بـ 7، أحرف).
 */
export function normalizeIraqiPhone(input: string): string | null {
  const compact = toLatinDigits(input).replace(/[\s\-().‎‏]/g, '');
  const national = /^(?:\+964|00964|964|0)?(7\d{9})$/.exec(compact)?.[1];
  return national ? `+964${national}` : null;
}

/** نفس الرقم بدون "+" (كما يخزنه Supabase Auth في auth.users.phone و profiles.phone). */
export function toStoredPhone(e164: string): string {
  return e164.replace(/^\+/, '');
}
