// مربعات العنوان بتفاصيل الطلب (SPEC-driver §2.8): البلوك، البناية، الطابق (0 ← G)، الشقة. المفقود يُخفى.
// نصوص اللقطة تُعرض كما هي بلا تحقق (عناوين قديمة ممكنة: طابق حتى 20، شقة نص حر، بلوك B4..B7).
import { floorOptionLabel } from '@mukhdar/shared';
import { ar } from '../../i18n/ar';
import type { AddressSnapshotView } from './types';

export type AddressBoxKey = 'block' | 'building' | 'floor' | 'apartment';
export interface AddressBox {
  key: AddressBoxKey;
  label: string;
  value: string;
}

const text = (v: string | null | undefined) => (v ?? '').trim();

export function addressBoxes(snapshot: AddressSnapshotView | null): AddressBox[] {
  const s = snapshot ?? {};
  const boxes: AddressBox[] = [];
  if (text(s.subsection))
    boxes.push({ key: 'block', label: ar.orders.block, value: text(s.subsection) });
  if (text(s.building))
    boxes.push({ key: 'building', label: ar.orders.building, value: text(s.building) });
  if (typeof s.floor === 'number' && Number.isInteger(s.floor) && s.floor >= 0) {
    boxes.push({ key: 'floor', label: ar.orders.floor, value: floorOptionLabel(s.floor) });
  }
  if (text(s.apartment))
    boxes.push({ key: 'apartment', label: ar.orders.apartment, value: text(s.apartment) });
  return boxes;
}

/**
 * طلب زبون محذوف (T23 M5): الاسم null ولقطة العنوان قطاع ووحدة فقط (بلا بناية). نعتمد غياب الاسم وغياب البناية معاً
 * حتى لا يُعامل طلب عادي ناقص الحقول كزبون محذوف.
 */
export function isDeletedCustomerSnapshot(
  snapshot: AddressSnapshotView | null,
  customerName: string | null,
): boolean {
  return customerName === null && text(snapshot?.building) === '';
}
