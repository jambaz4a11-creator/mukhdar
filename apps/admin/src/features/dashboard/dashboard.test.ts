import { describe, expect, it } from 'vitest';
import { formatAdminQuantity, formatIQD } from '@mukhdar/shared';
import { parseDashboard, type Dashboard } from './api';
import { changePercent, countDelta, netYesterday, percentDelta } from './delta';
import { buildKpis } from './kpis';

const base: Record<string, unknown> = {
  day: '2020-03-11',
  as_of: '2020-03-11T09:30:20+00:00',
  delivered_count: 3,
  delivered_count_prev: 1,
  cancelled_count: 1,
  cancelled_count_prev: 1,
  placed_count: 7,
  placed_count_prev: 5,
  open: { pending: 2, preparing: 1, ready: 1, out_for_delivery: 1 },
  low_stock_count: 2,
  low_stock_items: [
    { product_id: 'a', name: 'نافد', unit: 'نص كيلو', qty: 0, threshold: 5 },
    { product_id: 'b', name: 'قليل', unit: 'باقة', qty: 3, threshold: 5 },
  ],
  sales_iqd: 9000,
  sales_prev_iqd: 6000,
  avg_order_iqd: 3000,
  avg_order_prev_iqd: 6000,
  waste_cost_iqd: 1000,
  net_profit_iqd: 500,
  net_profit_prev_iqd: 1500,
};

const staff: Record<string, unknown> = {
  ...base,
  sales_iqd: null,
  sales_prev_iqd: null,
  avg_order_iqd: null,
  avg_order_prev_iqd: null,
  waste_cost_iqd: null,
  net_profit_iqd: null,
  net_profit_prev_iqd: null,
};

describe('changePercent', () => {
  it('increase, decrease and rounding', () => {
    expect(changePercent(112, 100)).toBe(12);
    expect(changePercent(97, 100)).toBe(-3);
    expect(changePercent(100, 300)).toBe(-67);
  });
  it('yesterday zero or missing: null (shown as "—", never ∞%)', () => {
    expect(changePercent(50, 0)).toBeNull();
    expect(changePercent(0, 0)).toBeNull();
    expect(changePercent(50, null)).toBeNull();
  });
  it('today zero against a real yesterday: -100%', () => {
    expect(changePercent(0, 200)).toBe(-100);
  });
});

describe('percentDelta', () => {
  it('up is good, down is bad', () => {
    expect(percentDelta(112, 100)).toEqual({ text: '▲ 12% عن أمس لنفس الساعة', tone: 'good' });
    expect(percentDelta(97, 100)).toEqual({ text: '▼ 3% عن أمس لنفس الساعة', tone: 'bad' });
  });
  it('no yesterday data: "—" and flat', () => {
    expect(percentDelta(500, 0)).toEqual({ text: '—', tone: 'flat' });
    expect(percentDelta(500, null)).toEqual({ text: '—', tone: 'flat' });
  });
  it('identical: "same as yesterday", flat', () => {
    expect(percentDelta(100, 100).tone).toBe('flat');
  });
  it('tiny change rounds to zero but is not "same"', () => {
    expect(percentDelta(1001, 1000)).toEqual({ text: '= 0% عن أمس لنفس الساعة', tone: 'flat' });
  });
});

describe('countDelta', () => {
  it('absolute difference with an arrow', () => {
    expect(countDelta(38, 33)).toEqual({ text: '▲ 5 عن أمس لنفس الساعة', tone: 'good' });
    expect(countDelta(1, 3)).toEqual({ text: '▼ 2 عن أمس لنفس الساعة', tone: 'bad' });
  });
  it('cancelled: fewer is good, more is bad', () => {
    expect(countDelta(2, 3, true)).toEqual({ text: '▼ 1 عن أمس لنفس الساعة', tone: 'good' });
    expect(countDelta(4, 3, true).tone).toBe('bad');
  });
  it('yesterday zero still shows the plain difference (no division)', () => {
    expect(countDelta(2, 0).text).toBe('▲ 2 عن أمس لنفس الساعة');
    expect(countDelta(0, 0).tone).toBe('flat');
  });
});

describe('netYesterday', () => {
  it('whole yesterday, whole dinars; "—" when absent', () => {
    expect(netYesterday(71000).text).toBe('أمس كامل: 71,000 د.ع');
    expect(netYesterday(-250).text).toBe('أمس كامل: -250 د.ع');
    expect(netYesterday(null).text).toBe('أمس كامل: —');
  });
});

describe('parseDashboard', () => {
  it('accepts the admin and the staff shape', () => {
    expect(parseDashboard(base).sales_iqd).toBe(9000);
    expect(parseDashboard(staff).sales_iqd).toBeNull();
  });
  it('rejects fractions, negatives and missing keys', () => {
    expect(() => parseDashboard({ ...base, sales_iqd: 12.5 })).toThrow('sales_iqd');
    expect(() => parseDashboard({ ...base, placed_count: -1 })).toThrow('placed_count');
    expect(() => parseDashboard({ ...base, open: { pending: 1 } })).toThrow('open.preparing');
    expect(() => parseDashboard({ ...base, day: '11/3/2020' })).toThrow('day');
    expect(() => parseDashboard(null)).toThrow('DASHBOARD_SHAPE');
    const rest: Record<string, unknown> = { ...base };
    delete rest.low_stock_items;
    expect(() => parseDashboard(rest)).toThrow('low_stock_items');
  });
  it('rejects a malformed low-stock item', () => {
    expect(() =>
      parseDashboard({
        ...base,
        low_stock_items: [{ product_id: 'a', name: 'x', unit: 'u', qty: 1.5, threshold: 5 }],
      }),
    ).toThrow('low_stock_items[]');
  });
});

describe('buildKpis', () => {
  const admin = buildKpis(parseDashboard(base));
  const asStaff = buildKpis(parseDashboard(staff));

  it('admin: the 8 cards in the approved design order', () => {
    expect(admin.map((k) => k.id)).toEqual([
      'sales',
      'delivered',
      'cancelled',
      'net',
      'placed',
      'avg',
      'waste',
      'low',
    ]);
  });
  it('admin figures are whole dinars and counts, with the comparison', () => {
    const by = Object.fromEntries(admin.map((k) => [k.id, k]));
    expect(by.sales).toMatchObject({
      value: '9,000 د.ع',
      delta: { text: '▲ 50% عن أمس لنفس الساعة' },
    });
    expect(by.net).toMatchObject({ value: '500 د.ع', delta: { text: 'أمس كامل: 1,500 د.ع' } });
    expect(by.avg).toMatchObject({
      value: '3,000 د.ع',
      delta: { text: '▼ 50% عن أمس لنفس الساعة' },
    });
    expect(by.waste?.value).toBe('1,000 د.ع');
    expect(by.delivered?.value).toBe('3');
    expect(by.cancelled?.delta.tone).toBe('flat'); // 1 مقابل 1
    expect(by.placed?.delta.text).toBe('▲ 2 عن أمس لنفس الساعة');
  });
  it('staff: only count cards, and no dinar amount anywhere', () => {
    expect(asStaff.map((k) => k.id)).toEqual(['delivered', 'cancelled', 'placed', 'low']);
    const text = JSON.stringify(asStaff);
    expect(text).not.toContain('د.ع');
    expect(asStaff.every((k) => k.tag === 'الكل')).toBe(true);
  });
  it('a negative net profit is shown in full and flagged', () => {
    const k = buildKpis(parseDashboard({ ...base, net_profit_iqd: -8500 })).find(
      (x) => x.id === 'net',
    );
    expect(k).toMatchObject({ value: '-8,500 د.ع', valueClass: 'text-danger' });
  });
  it('no deliveries yet: average is "—", not 0', () => {
    const k = buildKpis(
      parseDashboard({ ...base, delivered_count: 0, avg_order_iqd: null, sales_iqd: 0 }),
    ).find((x) => x.id === 'avg');
    expect(k).toMatchObject({ value: '—', delta: { text: '—', tone: 'flat' } });
  });
  it('large numbers are never abbreviated', () => {
    const k = buildKpis(parseDashboard({ ...base, sales_iqd: 123_456_750 })).find(
      (x) => x.id === 'sales',
    );
    expect(k?.value).toBe('123,456,750 د.ع');
    expect(k?.value).toBe(formatIQD(123_456_750));
  });
});

describe('low stock quantities in kilos (adminUnits)', () => {
  it('half-kilo products in kilos, others in their unit', () => {
    const d = parseDashboard(base) as Dashboard;
    const kilo = d.low_stock_items[0];
    const bunch = d.low_stock_items[1];
    expect(kilo && formatAdminQuantity(kilo.threshold, kilo.unit)).toBe('2.5 كيلو');
    expect(bunch && formatAdminQuantity(bunch.qty, bunch.unit)).toBe('3 باقة');
  });
});

describe('stuck notifications (admin-only badge)', () => {
  it('number for the admin, null for staff, and tolerant of an older server', () => {
    expect(parseDashboard({ ...base, stuck_notifications: 3 }).stuck_notifications).toBe(3);
    expect(parseDashboard({ ...base, stuck_notifications: 0 }).stuck_notifications).toBe(0);
    expect(parseDashboard({ ...staff, stuck_notifications: null }).stuck_notifications).toBeNull();
    expect(parseDashboard(base).stuck_notifications).toBeNull();
  });
  it('rejects a fraction or a negative count', () => {
    expect(() => parseDashboard({ ...base, stuck_notifications: 1.5 })).toThrow(
      'stuck_notifications',
    );
    expect(() => parseDashboard({ ...base, stuck_notifications: -1 })).toThrow(
      'stuck_notifications',
    );
  });
});
