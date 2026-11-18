// عرض العنوان بنفس الصيغة بكل التطبيقات (مراجعة 2026-11-14، N6).
// الكلمات (قرار المالك 2026-11-18): "بلوك" (= الوحدة A3، القطاع جزء من اسمها) ← "بناية" ← "الطابق" ← "شقة".
// القيم المخزّنة بلا كلمات ("A3"، "12")، لذلك الصيغة هنا لا بكل شاشة.
// الإشعارات (داخل قاعدة البيانات) تستخدم نفس الصيغة المختصرة: "بلوك A3 - بناية 12".
import type { AddressSnapshot } from './types';

type AddressParts = Pick<AddressSnapshot, 'sector' | 'subsection' | 'building'> &
  Partial<Pick<AddressSnapshot, 'apartment' | 'floor'>>;

const clean = (v: string | null | undefined) => (v ?? '').trim();

/** "قطاع A" (يضيف الكلمة إن لم تكن موجودة). */
export function formatSector(sector: string): string {
  const s = clean(sector);
  return s === '' || s.startsWith('قطاع') ? s : `قطاع ${s}`;
}

/** الطابق للعرض: 0 ← "الطابق الأرضي"، 3 ← "الطابق 3"؛ غائب أو غير صالح ← "". */
export function formatFloor(floor: number | null | undefined): string {
  if (typeof floor !== 'number' || !Number.isInteger(floor) || floor < 0) return '';
  return floor === 0 ? 'الطابق الأرضي' : `الطابق ${floor}`;
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
