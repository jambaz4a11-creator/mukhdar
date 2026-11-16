import { describe, expect, it } from 'vitest';
import { parseSummary, type ReportSummary, type WasteRow, type DailyRow } from './api';
import { chartGeometry, labelEvery } from './chart';
import { BOM, dailyCsv, toCsv, wasteCsv } from './csv';
import { addDays, percent, presetRange, rangeDays, rangeError, rangeLabel } from './range';

const summary: ReportSummary = {
  from: '2020-03-10',
  to: '2020-03-12',
  placed_count: 5,
  delivered_count: 2,
  cancelled_count: 2,
  sales_iqd: 10000,
  delivery_fees_iqd: 2000,
  cost_iqd: 6500,
  gross_profit_iqd: 3500,
  waste_cost_iqd: 9250,
  adjust_loss_iqd: 1000,
  net_profit_iqd: -6750,
  avg_order_iqd: 5000,
  rating_count: 2,
  rating_avg: 4.5,
};

describe('range', () => {
  const today = '2026-11-16';
  it('presets use the Baghdad day', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today });
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-11-15', to: '2026-11-15' });
    expect(presetRange('7d', today)).toEqual({ from: '2026-11-10', to: today });
    expect(presetRange('month', today)).toEqual({ from: '2026-11-01', to: today });
    expect(presetRange('7d', '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' });
  });
  it('counts days inclusively', () => {
    expect(rangeDays({ from: today, to: today })).toBe(1);
    expect(rangeDays({ from: '2020-01-01', to: '2020-12-31' })).toBe(366);
    expect(addDays('2020-02-28', 1)).toBe('2020-02-29');
  });
  it('validates a custom range (max 366 days, like the database)', () => {
    expect(rangeError({ from: '2020-01-01', to: '2020-12-31' })).toBeNull();
    expect(rangeError({ from: '2020-01-01', to: '2021-01-01' })).toMatch(/366/);
    expect(rangeError({ from: '2020-03-12', to: '2020-03-10' })).toMatch(/بعد/);
    expect(rangeError({ from: '', to: '2020-03-10' })).not.toBeNull();
    expect(rangeError({ from: '2020-02-30', to: '2020-03-10' })).not.toBeNull();
  });
  it('labels and percentages', () => {
    expect(rangeLabel({ from: today, to: today })).toBe(today);
    expect(percent(9, 421)).toBe('2.1%');
    expect(percent(1, 0)).toBeNull();
  });
});

describe('parseSummary', () => {
  it('accepts integer amounts and null averages', () => {
    expect(parseSummary(summary)).toEqual(summary);
    expect(
      parseSummary({ ...summary, avg_order_iqd: null, rating_avg: null }).avg_order_iqd,
    ).toBeNull();
  });
  it('rejects fractional or missing amounts (no float money)', () => {
    expect(() => parseSummary({ ...summary, sales_iqd: 100.5 })).toThrow(/sales_iqd/);
    expect(() => parseSummary({ ...summary, net_profit_iqd: undefined })).toThrow(/net_profit_iqd/);
    expect(() => parseSummary(null)).toThrow();
  });
});

describe('CSV', () => {
  const waste: WasteRow[] = [
    {
      product_id: 'a',
      name: 'طماطة',
      unit: 'نص كيلو',
      waste_qty: 7,
      waste_cost_iqd: 8500,
      shortage_qty: 0,
      shortage_cost_iqd: 0,
      total_cost_iqd: 8500,
    },
    {
      product_id: 'b',
      name: 'نعناع, طازج',
      unit: 'باقة',
      waste_qty: 3,
      waste_cost_iqd: 750,
      shortage_qty: 4,
      shortage_cost_iqd: 1000,
      total_cost_iqd: 1750,
    },
  ];
  it('waste: 7 half-kilos = 3.5 كيلو, 3 bunches = 3 باقة, with a unit column', () => {
    const lines = wasteCsv(waste).replace(BOM, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'المنتج,الوحدة,كمية الهدر,كلفة الهدر,كمية نقص الجرد,كلفة نقص الجرد,المجموع',
    );
    expect(lines[1]).toBe('طماطة,كيلو,3.5,8500,0,0,8500');
    expect(lines[2]).toBe('"نعناع, طازج",باقة,3,750,4,1000,1750');
  });
  it('daily: one row per day plus the database total, integer dinars', () => {
    const days: DailyRow[] = [
      {
        day: '2020-03-10',
        placed_count: 2,
        delivered_count: 1,
        cancelled_count: 0,
        sales_iqd: 7000,
        delivery_fees_iqd: 1000,
        cost_iqd: 4500,
        gross_profit_iqd: 2500,
        waste_cost_iqd: 0,
        adjust_loss_iqd: 0,
        net_profit_iqd: 2500,
      },
    ];
    const csv = dailyCsv(days, summary);
    expect(csv.startsWith(BOM)).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('2020-03-10,2,1,0,7000,1000,4500,2500,0,0,2500');
    expect(lines[2]).toBe('المجموع,5,2,2,10000,2000,6500,3500,9250,1000,-6750');
  });
  it('escapes quotes and newlines', () => {
    expect(toCsv([['a"b', 'c\nd', null]])).toBe(`${BOM}"a""b","c\nd",\r\n`);
  });
});

describe('chartGeometry', () => {
  it('puts the zero line under positive bars and negative net profit below it', () => {
    const g = chartGeometry([
      { day: 'a', sales_iqd: 7000, net_profit_iqd: 2500 },
      { day: 'b', sales_iqd: 0, net_profit_iqd: -3000 },
    ]);
    expect(g.zeroPct).toBe(70);
    expect(g.bars[0]).toEqual({ day: 'a', salesPct: 70, netPct: 25, netNegative: false });
    expect(g.bars[1]).toEqual({ day: 'b', salesPct: 0, netPct: 30, netNegative: true });
  });
  it('empty range draws nothing (no division by zero)', () => {
    expect(chartGeometry([{ day: 'a', sales_iqd: 0, net_profit_iqd: 0 }]).bars[0]?.salesPct).toBe(
      0,
    );
  });
  it('thins axis labels', () => {
    expect(labelEvery(7)).toBe(1);
    expect(labelEvery(31)).toBe(5);
  });
});
