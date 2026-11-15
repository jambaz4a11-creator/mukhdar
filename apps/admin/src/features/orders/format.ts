// عرض بيانات الطلب بلوحة التفاصيل والجدول والإيصال.
import { formatAddress, formatAddressShort, type AddressSnapshot } from '@mukhdar/shared';

/** "9647701234567" ← "07701234567" للعرض والاتصال المحلي. غير ذلك كما هو. */
export function displayPhone(stored: string | null | undefined): string {
  if (!stored) return '';
  const m = /^\+?964(7\d{9})$/.exec(stored.replace(/\s/g, ''));
  return m ? `0${m[1]}` : stored;
}

/** روابط الاتصال: tel بالصيغة الدولية، وواتساب بالأرقام فقط (wa.me بلا +). */
export function phoneLinks(
  stored: string | null | undefined,
): { tel: string; whatsapp: string } | null {
  const m = stored ? /^\+?964(7\d{9})$/.exec(stored.replace(/\s/g, '')) : null;
  if (!m) return null;
  return { tel: `tel:+964${m[1]}`, whatsapp: `https://wa.me/964${m[1]}` };
}

/** address_snapshot من قاعدة البيانات (jsonb) كعنوان مكتمل الحقول. */
export function asAddress(snapshot: unknown): AddressSnapshot {
  const s = (snapshot ?? {}) as Partial<Record<keyof AddressSnapshot, unknown>>;
  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  return {
    address_id: str(s.address_id),
    sector: str(s.sector),
    subsection: str(s.subsection),
    building: str(s.building),
    apartment: str(s.apartment),
    note: typeof s.note === 'string' && s.note.trim() !== '' ? s.note : null,
  };
}

export function fullAddress(snapshot: unknown): string {
  return formatAddress(asAddress(snapshot));
}

export function shortAddress(snapshot: unknown): string {
  return formatAddressShort(asAddress(snapshot));
}

/** الوقت بتوقيت بغداد بأرقام لاتينية: "10:52 ص". */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Baghdad',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod') === 'AM' ? 'ص' : 'م'}`;
}

/** "2026-11-16 10:52 ص" بتوقيت بغداد. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(d);
  return `${day} ${formatTime(iso)}`;
}

/** التكلفة والربح للأدمن: Σ(كلفة الوحدة × الكمية)، والربح = المجموع الفرعي − التكلفة. */
export function costAndProfit(
  items: { id: number; qty: number }[],
  costs: { order_item_id: number; cost_snapshot_iqd: number }[],
  subtotal: number,
): { cost: number; profit: number; missing: number } {
  const byItem = new Map(costs.map((c) => [c.order_item_id, c.cost_snapshot_iqd]));
  let cost = 0;
  let missing = 0;
  for (const i of items) {
    const c = byItem.get(i.id);
    if (c === undefined) missing += 1;
    else cost += c * i.qty;
  }
  return { cost, profit: subtotal - cost, missing };
}
