import { describe, expect, it } from 'vitest';
import {
  baghdadDayRange,
  baghdadToday,
  conditionsFor,
  isDay,
  keysetFilter,
  parseSearch,
  parseTab,
  tabLabel,
  type OrdersFilters,
} from './filters';

const TODAY = '2026-11-16';
const f = (patch: Partial<OrdersFilters>): OrdersFilters => ({
  tab: 'pending',
  day: null,
  driverId: null,
  search: '',
  ...patch,
});

describe('Baghdad days (UTC+3)', () => {
  it('today rolls over at 21:00 UTC', () => {
    expect(baghdadToday(new Date('2026-11-15T20:59:00Z'))).toBe('2026-11-15');
    expect(baghdadToday(new Date('2026-11-15T21:00:00Z'))).toBe('2026-11-16');
  });
  it('day range is [00:00, 24:00) Baghdad as UTC', () => {
    expect(baghdadDayRange('2026-11-16')).toEqual({
      from: '2026-11-15T21:00:00.000Z',
      to: '2026-11-16T21:00:00.000Z',
    });
  });
  it('validates days', () => {
    expect(isDay('2026-11-16')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('16-11-2026')).toBe(false);
    expect(isDay(null)).toBe(false);
  });
});

describe('parseSearch', () => {
  it.each([
    ['', { kind: 'none' }],
    ['1048', { kind: 'order_number', value: 1048 }],
    ['#1048', { kind: 'order_number', value: 1048 }],
    ['07701234567', { kind: 'phone', value: '9647701234567' }],
    ['0770 123 4567', { kind: 'phone', value: '9647701234567' }],
    ['+9647701234567', { kind: 'phone', value: '9647701234567' }],
    ['٠٧٧٠١٢٣٤٥٦٧', { kind: 'phone', value: '9647701234567' }],
    ['أحمد', { kind: 'invalid' }],
    ['12345678901', { kind: 'invalid' }],
  ])('%s', (input, out) => {
    expect(parseSearch(input)).toEqual(out);
  });
});

describe('conditionsFor', () => {
  it('open tabs: all open orders, no day by default', () => {
    expect(conditionsFor(f({ tab: 'preparing' }), TODAY)).toEqual({
      status: 'preparing',
      range: null,
      driverId: null,
      orderNumber: null,
      phone: null,
    });
  });

  it('open tab with a day filters created_at', () => {
    const c = conditionsFor(f({ tab: 'pending', day: '2026-11-14' }), TODAY);
    expect(c !== 'invalid' && c.range).toEqual({
      column: 'created_at',
      ...baghdadDayRange('2026-11-14'),
    });
  });

  it('delivered tab = delivered today by delivered_at; cancelled by cancelled_at', () => {
    const d = conditionsFor(f({ tab: 'delivered' }), TODAY);
    expect(d !== 'invalid' && d.range).toEqual({
      column: 'delivered_at',
      ...baghdadDayRange(TODAY),
    });
    const c = conditionsFor(f({ tab: 'cancelled', day: '2026-11-10' }), TODAY);
    expect(c !== 'invalid' && c.range).toEqual({
      column: 'cancelled_at',
      ...baghdadDayRange('2026-11-10'),
    });
  });

  it('search ignores tab and day but keeps the driver filter', () => {
    expect(
      conditionsFor(
        f({ tab: 'delivered', day: '2026-11-10', driverId: 'd1', search: '#77' }),
        TODAY,
      ),
    ).toEqual({
      status: null,
      range: null,
      driverId: 'd1',
      orderNumber: 77,
      phone: null,
    });
    const p = conditionsFor(f({ search: '07701234567' }), TODAY);
    expect(p !== 'invalid' && p.phone).toBe('9647701234567');
  });

  it('invalid search is reported, not queried', () => {
    expect(conditionsFor(f({ search: 'abc' }), TODAY)).toBe('invalid');
  });
});

describe('keyset and tabs', () => {
  it('keyset: older, or same time and smaller id', () => {
    expect(keysetFilter({ created_at: '2026-11-16T07:00:00+00:00', id: 'abc' })).toBe(
      'created_at.lt."2026-11-16T07:00:00+00:00",and(created_at.eq."2026-11-16T07:00:00+00:00",id.lt.abc)',
    );
  });
  it('parseTab falls back to pending', () => {
    expect(parseTab('ready')).toBe('ready');
    expect(parseTab('nope')).toBe('pending');
    expect(parseTab(null)).toBe('pending');
  });
  it('day tabs say "today" or the date', () => {
    expect(tabLabel('delivered', TODAY, TODAY)).toBe('مسلّم اليوم');
    expect(tabLabel('cancelled', '2026-11-10', TODAY)).toBe('ملغي 2026-11-10');
    expect(tabLabel('pending', TODAY, TODAY)).toBe('جديد');
  });
});
