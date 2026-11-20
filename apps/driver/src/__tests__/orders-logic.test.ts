// منطق T31 الصرف (SPEC-driver §2.6–§2.8، §6): nextAction، مربعات العنوان، روابط الاتصال، الزمن، الإزالة.
import { addressBoxes, isDeletedCustomerSnapshot } from '../features/orders/address';
import { customerTelUrl, customerWhatsappUrl } from '../features/orders/contact';
import { removedOrders } from '../features/orders/mine';
import { formatBaghdadClock, minutesSince } from '../features/orders/time';
import { nextAction, statusLabel } from '../features/orders/transitions';

describe('nextAction (SPEC-driver §6)', () => {
  it('ready -> out_for_delivery, no confirmation', () => {
    expect(nextAction('ready')).toEqual({ to: 'out_for_delivery', confirm: false });
  });
  it('out_for_delivery -> delivered with double confirmation', () => {
    expect(nextAction('out_for_delivery')).toEqual({ to: 'delivered', confirm: true });
  });
  it.each(['pending', 'preparing', 'delivered', 'cancelled'] as const)('%s -> no action', (s) => {
    expect(nextAction(s)).toBeNull();
  });
});

describe('statusLabel (driver wording)', () => {
  it('uses the design labels', () => {
    expect(statusLabel('out_for_delivery')).toBe('بالطريق');
    expect(statusLabel('ready')).toBe('مقبول، بعده بالمحل');
    expect(statusLabel('preparing')).toBe('بانتظار التحضير');
  });
  it('final statuses fall back to the shared labels', () => {
    expect(statusLabel('delivered')).toBe('تم التوصيل');
    expect(statusLabel('cancelled')).toBe('أُلغي الطلب');
  });
});

describe('addressBoxes', () => {
  const full = { sector: 'قطاع A', subsection: 'A3', building: '12', floor: 3, apartment: '10' };
  it('block, building, floor, apartment as plain values', () => {
    expect(addressBoxes(full)).toEqual([
      { key: 'block', label: 'البلوك', value: 'A3' },
      { key: 'building', label: 'البناية', value: '12' },
      { key: 'floor', label: 'الطابق', value: '3' },
      { key: 'apartment', label: 'الشقة', value: '10' },
    ]);
  });
  it('floor 0 is shown as G', () => {
    expect(addressBoxes({ ...full, floor: 0 }).find((b) => b.key === 'floor')?.value).toBe('G');
  });
  it('missing floor (old address) hides the box', () => {
    const old: Partial<typeof full> = { ...full };
    delete old.floor;
    expect(addressBoxes(old).map((b) => b.key)).toEqual(['block', 'building', 'apartment']);
    expect(addressBoxes({ ...full, floor: null }).map((b) => b.key)).not.toContain('floor');
  });
  it('old data is shown as-is, never validated (floor 14, free-text apartment)', () => {
    const boxes = addressBoxes({ ...full, floor: 14, apartment: 'الدار الثانية' });
    expect(boxes.find((b) => b.key === 'floor')?.value).toBe('14');
    expect(boxes.find((b) => b.key === 'apartment')?.value).toBe('الدار الثانية');
  });
  it('deleted customer snapshot (sector + subsection only)', () => {
    const snap = { sector: 'قطاع A', subsection: 'A3' };
    expect(isDeletedCustomerSnapshot(snap, null)).toBe(true);
    expect(addressBoxes(snap).map((b) => b.key)).toEqual(['block']);
  });
  it('a normal order is not a deleted customer', () => {
    expect(isDeletedCustomerSnapshot(full, 'حيدر')).toBe(false);
  });
});

describe('contact links', () => {
  it('stored 9647… and 07… give tel:07… and wa.me/9647…', () => {
    expect(customerTelUrl('9647701234567')).toBe('tel:07701234567');
    expect(customerTelUrl('07701234567')).toBe('tel:07701234567');
    expect(customerWhatsappUrl('07701234567')).toBe('https://wa.me/9647701234567');
    expect(customerWhatsappUrl('+9647701234567')).toBe('https://wa.me/9647701234567');
  });
  it('null or invalid number gives no link', () => {
    expect(customerTelUrl(null)).toBeNull();
    expect(customerWhatsappUrl('123')).toBeNull();
  });
});

describe('time', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  it('minutesSince clamps at zero and floors', () => {
    expect(minutesSince('2026-11-20T09:55:30Z', now)).toBe(4);
    expect(minutesSince('2026-11-20T10:05:00Z', now)).toBe(0);
  });
  it('Baghdad clock is UTC+3, 12h with ص/م, Latin digits', () => {
    expect(formatBaghdadClock('2026-11-20T07:48:00Z')).toBe('10:48 ص');
    expect(formatBaghdadClock('2026-11-20T12:05:00Z')).toBe('3:05 م');
    expect(formatBaghdadClock('2026-11-20T21:30:00Z')).toBe('12:30 ص');
    expect(formatBaghdadClock('2026-11-20T09:00:00Z')).toBe('12:00 م');
  });
});

describe('removedOrders: vanished or cancelled orders leave "my orders" with a message', () => {
  const o = (id: string, status: string) => ({ id, status }) as never;
  it('order missing from the new list -> removed', () => {
    expect(removedOrders([o('a', 'ready'), o('b', 'ready')], [o('a', 'ready')])).toEqual([
      { id: 'b', reason: 'gone' },
    ]);
  });
  it('cancelled in the new list -> removed with reason cancelled', () => {
    expect(removedOrders([o('a', 'ready')], [o('a', 'cancelled')])).toEqual([
      { id: 'a', reason: 'cancelled' },
    ]);
  });
  it('delivered (by the panel) is not a removal', () => {
    expect(removedOrders([o('a', 'out_for_delivery')], [o('a', 'delivered')])).toEqual([]);
  });
  it('unchanged or advanced -> nothing', () => {
    expect(removedOrders([o('a', 'ready')], [o('a', 'out_for_delivery')])).toEqual([]);
  });
});
