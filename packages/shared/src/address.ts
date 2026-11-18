// عرض العنوان بنفس الصيغة بكل التطبيقات (مراجعة 2026-11-14، N6).
// القطاع مخزّن بالكلمة ("قطاع A")، والوحدة والعمارة بدونها ("A3"، "12")، لذلك الصيغة هنا لا بكل شاشة.
// الإشعارات (داخل قاعدة البيانات) تستخدم نفس الصيغة المختصرة: "وحدة A3 - عمارة 12".
import type { AddressSnapshot } from './types';

type AddressParts = Pick<AddressSnapshot, 'sector' | 'subsection' | 'building'> &
  Partial<Pick<AddressSnapshot, 'apartment' | 'floor'>>;

const clean = (v: string | null | undefined) => (v ?? '').trim();

/** "قطاع A" (يضيف الكلمة إن لم تكن موجودة). */
export function formatSector(sector: string): string {
  const s = clean(sector);
  return s === '' || s.startsWith('قطاع') ? s : `قطاع ${s}`;
}

/** الطابق للعرض: 0 ← "الطابق الأرضي"، 3 ← "طابق 3"؛ غائب أو غير صالح ← "". */
export function formatFloor(floor: number | null | undefined): string {
  if (typeof floor !== 'number' || !Number.isInteger(floor) || floor < 0) return '';
  return floor === 0 ? 'الطابق الأرضي' : `طابق ${floor}`;
}

/** "قطاع A · وحدة A3 · عمارة 12 · طابق 3 · شقة 5" (الأجزاء الفارغة تُحذف). للتفاصيل والإيصال. */
export function formatAddress(address: AddressParts): string {
  const parts = [
    formatSector(address.sector),
    clean(address.subsection) && `وحدة ${clean(address.subsection)}`,
    clean(address.building) && `عمارة ${clean(address.building)}`,
    formatFloor(address.floor),
    clean(address.apartment) && `شقة ${clean(address.apartment)}`,
  ];
  return parts.filter((p) => p !== '').join(' · ');
}

/** "وحدة A3 - عمارة 12": للقوائم والجداول (مطابقة لنص الإشعارات). */
export function formatAddressShort(
  address: Pick<AddressSnapshot, 'subsection' | 'building'>,
): string {
  // طلب زبون محذوف (T23 M5) بلا عمارة: "وحدة A3" فقط
  const unit = clean(address.subsection);
  const building = clean(address.building);
  return [unit && `وحدة ${unit}`, building && `عمارة ${building}`]
    .filter((p) => p !== '')
    .join(' - ');
}
