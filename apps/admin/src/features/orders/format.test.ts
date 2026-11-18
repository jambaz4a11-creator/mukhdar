import { describe, expect, it, vi } from 'vitest';
import type { MukhdarClient } from '@mukhdar/shared';
import { fetchOrderCosts } from './api';
import {
  asAddress,
  costAndProfit,
  displayPhone,
  formatTime,
  fullAddress,
  phoneLinks,
  shortAddress,
} from './format';

const snapshot = {
  address_id: 'a1',
  sector: 'قطاع A',
  subsection: 'A3',
  building: '45',
  apartment: '12',
  note: 'الطابق الثالث',
};

describe('detail panel: full address and phone', () => {
  it('full address via formatAddress (sector → unit → building → apartment)', () => {
    expect(fullAddress(snapshot)).toBe('قطاع A · وحدة A3 · عمارة 45 · شقة 12');
    expect(shortAddress(snapshot)).toBe('وحدة A3 - عمارة 45');
  });

  it('shows the floor on the details and the receipt (2026-11-18), ignores bad values', () => {
    expect(fullAddress({ ...snapshot, floor: 4 })).toBe(
      'قطاع A · وحدة A3 · عمارة 45 · طابق 4 · شقة 12',
    );
    expect(fullAddress({ ...snapshot, floor: 0 })).toContain('الطابق الأرضي');
    expect(asAddress({ ...snapshot, floor: '4' }).floor).toBeNull();
    expect(asAddress(snapshot).floor).toBeNull();
  });

  it('keeps the address note, drops blank notes', () => {
    expect(asAddress(snapshot).note).toBe('الطابق الثالث');
    expect(asAddress({ ...snapshot, note: '  ' }).note).toBeNull();
    expect(asAddress(null)).toMatchObject({ sector: '', building: '', note: null });
  });

  it('shows the phone as 07… and builds call / WhatsApp links', () => {
    expect(displayPhone('9647701234567')).toBe('07701234567');
    expect(phoneLinks('9647701234567')).toEqual({
      tel: 'tel:+9647701234567',
      whatsapp: 'https://wa.me/9647701234567',
    });
    expect(phoneLinks(null)).toBeNull();
    expect(phoneLinks('12345')).toBeNull();
    expect(displayPhone(null)).toBe('');
  });

  it('time in Baghdad with Latin digits', () => {
    expect(formatTime('2026-11-16T07:52:00Z')).toBe('10:52 ص');
    expect(formatTime('2026-11-16T13:05:00Z')).toBe('4:05 م');
  });
});

describe('admin cost and profit', () => {
  it('Σ cost × qty, profit = subtotal − cost, counts missing costs', () => {
    const items = [
      { id: 1, qty: 2 },
      { id: 2, qty: 1 },
      { id: 3, qty: 4 },
    ];
    const costs = [
      { order_item_id: 1, cost_snapshot_iqd: 750 },
      { order_item_id: 2, cost_snapshot_iqd: 1000 },
    ];
    expect(costAndProfit(items, costs, 6000)).toEqual({ cost: 2500, profit: 3500, missing: 1 });
  });

  it('staff never query order_item_costs', async () => {
    const from = vi.fn();
    const client = { from } as unknown as MukhdarClient;
    await expect(fetchOrderCosts(client, 'staff', [1, 2])).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('admin queries order_item_costs for the order items', async () => {
    const inFn = vi
      .fn()
      .mockResolvedValue({ data: [{ order_item_id: 1, cost_snapshot_iqd: 500 }], error: null });
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    const client = { from } as unknown as MukhdarClient;
    await expect(fetchOrderCosts(client, 'admin', [1])).resolves.toEqual([
      { order_item_id: 1, cost_snapshot_iqd: 500 },
    ]);
    expect(from).toHaveBeenCalledWith('order_item_costs');
    expect(inFn).toHaveBeenCalledWith('order_item_id', [1]);
  });
});
