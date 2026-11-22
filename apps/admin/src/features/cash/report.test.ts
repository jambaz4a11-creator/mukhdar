import { describe, expect, it } from 'vitest';
import { BOM } from '@/features/reports/csv';
import { cashCsv, cashCsvFileName, parseCashReport } from './report';

const raw = {
  from: '2026-11-16',
  to: '2026-11-22',
  held_now_iqd: 125_000,
  held_now_drivers: 2,
  totals: {
    handover_count: 3,
    expected_iqd: 200_000,
    received_iqd: 199_000,
    shortage_iqd: 2_000,
    overage_iqd: 1_000,
    net_difference_iqd: -1_000,
    fees_kept_iqd: 3_000,
  },
  drivers: [
    {
      driver_id: 'd1',
      full_name: 'علي',
      handover_count: 2,
      expected_iqd: 150_000,
      received_iqd: 148_000,
      shortage_iqd: 2_000,
      overage_iqd: 0,
      net_difference_iqd: -2_000,
      fees_kept_iqd: 2_000,
      held_now_iqd: 75_000,
    },
    {
      driver_id: null,
      full_name: null,
      handover_count: 1,
      expected_iqd: 50_000,
      received_iqd: 51_000,
      shortage_iqd: 0,
      overage_iqd: 1_000,
      net_difference_iqd: 1_000,
      fees_kept_iqd: 1_000,
      held_now_iqd: 0,
    },
  ],
};

describe('parseCashReport', () => {
  it('accepts the report_cash shape', () => {
    const r = parseCashReport(raw);
    expect(r.held_now_iqd).toBe(125_000);
    expect(r.drivers).toHaveLength(2);
  });
  it('rejects non-integer amounts (report must be whole dinars)', () => {
    expect(() => parseCashReport({ ...raw, held_now_iqd: 1.5 })).toThrow('REPORT_SHAPE');
    expect(() => parseCashReport({ ...raw, totals: { ...raw.totals, shortage_iqd: '1' } })).toThrow(
      'REPORT_SHAPE',
    );
  });
  it('R4 M1: requires fees_kept_iqd in the totals and per driver', () => {
    const totals: Record<string, unknown> = { ...raw.totals };
    delete totals.fees_kept_iqd;
    expect(() => parseCashReport({ ...raw, totals })).toThrow('REPORT_SHAPE: fees_kept_iqd');
    expect(parseCashReport(raw).totals.fees_kept_iqd).toBe(3_000);
  });
  it('T6: keeps the deleted driver (driver_id and full_name null) as its own row', () => {
    const d = parseCashReport(raw).drivers.find((x) => x.driver_id === null);
    expect(d?.full_name).toBeNull();
    expect(d?.handover_count).toBe(1);
  });
  it('rejects a non-object', () => {
    expect(() => parseCashReport(null)).toThrow('REPORT_SHAPE');
  });
});

describe('cashCsv', () => {
  const csv = cashCsv(parseCashReport(raw));
  it('starts with a BOM and has Arabic headers', () => {
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toContain('السائق');
    expect(csv).toContain('النقص');
    expect(csv).toContain('الزيادة');
    expect(csv).toContain('بيده الآن');
    expect(csv).toContain('أجرة التوصيل عنده');
  });
  it('writes plain integers (no thousands separators), a deleted driver label, and a total row', () => {
    expect(csv).toContain('علي,2,150000,148000,2000,0,2000,75000');
    expect(csv).toContain('سائق محذوف,1,50000,51000,0,1000,1000,0');
    expect(csv).toContain('المجموع,3,200000,199000,2000,1000,3000,125000');
  });
  it('file name carries the range', () => {
    expect(cashCsvFileName('2026-11-16', '2026-11-22')).toBe(
      'mukhdar-cash-2026-11-16_2026-11-22.csv',
    );
  });
});
