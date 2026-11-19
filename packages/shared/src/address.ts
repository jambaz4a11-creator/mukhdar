// عرض العنوان بنفس الصيغة بكل التطبيقات (مراجعة 2026-11-14، N6).
// الأرضي يظهر "G" (2026-11-19). الكلمات (قرار المالك 2026-11-18): "بلوك" (= الوحدة A3، القطاع جزء من اسمها) ← "بناية" ← "الطابق" ← "شقة".
// القيم المخزّنة بلا كلمات ("A3"، "12")، لذلك الصيغة هنا لا بكل شاشة.
// الإشعارات (داخل قاعدة البيانات) تستخدم نفس الصيغة المختصرة: "بلوك A3 - بناية 12".
import type { AddressSnapshot } from './types';

type AddressParts = Pick<AddressSnapshot, 'sector' | 'subsection' | 'building'> &
  Partial<Pick<AddressSnapshot, 'apartment' | 'floor'>>;

const clean = (v: string | null | undefined) => (v ?? '').trim();

// نطاقات بسماية (قرار المالك 2026-11-19): الطابق G (يُخزَّن 0) و1..9، والشقة 1..12.
// نفس القيم بقاعدة البيانات (migration 20261207000001) وبقوائم نموذج العنوان.
export const FLOOR_MIN = 0;
export const FLOOR_MAX = 9;
export const APARTMENT_MIN = 1;
export const APARTMENT_MAX = 12;
/** الأرضي يُعرض دائماً "G" بكل مكان (يُخزَّن 0). */
export const GROUND_FLOOR_LABEL = 'G';

/** طابق صالح لعنوان جديد: عدد صحيح 0..9. */
export function isValidFloor(floor: number | null | undefined): floor is number {
  return (
    typeof floor === 'number' && Number.isInteger(floor) && floor >= FLOOR_MIN && floor <= FLOOR_MAX
  );
}

/** شقة صالحة لعنوان جديد: أرقام لاتينية 1..12 بلا أصفار بالبداية ("٥" العربية وكلمات حرة غير صالحة). */
export function isValidApartment(apartment: string | null | undefined): boolean {
  const a = clean(apartment);
  if (!/^[1-9][0-9]?$/.test(a)) return false;
  const n = Number(a);
  return n >= APARTMENT_MIN && n <= APARTMENT_MAX;
}

/** اسم الطابق بقائمة الاختيار: "G" للأرضي، وإلا الرقم. */
export function floorOptionLabel(floor: number): string {
  return floor === 0 ? GROUND_FLOOR_LABEL : String(floor);
}

/** "قطاع A" (يضيف الكلمة إن لم تكن موجودة). */
export function formatSector(sector: string): string {
  const s = clean(sector);
  return s === '' || s.startsWith('قطاع') ? s : `قطاع ${s}`;
}

/** الطابق للعرض: 0 ← "الطابق G"، 3 ← "الطابق 3"؛ غائب أو غير صالح ← "". (يعرض أي طابق قديم صحيح، حتى فوق 9.) */
export function formatFloor(floor: number | null | undefined): string {
  if (typeof floor !== 'number' || !Number.isInteger(floor) || floor < 0) return '';
  return `الطابق ${floorOptionLabel(floor)}`;
}

/** "بلوك A3 · بناية 12 · الطابق 3 · شقة 5" (الأجزاء الفارغة تُحذف). للتفاصيل والإيصال. */
export function formatAddress(address: AddressParts): string {
  const parts = [
    clean(address.subsection) && `بلوك ${clean(address.subsection)}`,
    clean(address.building) && `بناية ${clean(address.building)}`,
    formatFloor(address.floor),
    clean(address.apartment) && `شقة ${clean(address.apartment)}`,
  ];
  return parts.filter((p) => p !== '').join(' · ');
}

/** "بلوك A3 - بناية 12": للقوائم والجداول (مطابقة لنص الإشعارات). */
export function formatAddressShort(
  address: Pick<AddressSnapshot, 'subsection' | 'building'>,
): string {
  // طلب زبون محذوف (T23 M5) بلا بناية: "بلوك A3" فقط
  const unit = clean(address.subsection);
  const building = clean(address.building);
  return [unit && `بلوك ${unit}`, building && `بناية ${building}`]
    .filter((p) => p !== '')
    .join(' - ');
}
