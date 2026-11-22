import { describe, expect, it } from 'vitest';
import { cashDifference, differenceLabel } from './difference';

describe('cashDifference', () => {
  it('matches when received equals expected', () => {
    expect(cashDifference(50_000, 50_000)).toEqual({ kind: 'match', amount: 0 });
  });
  it('is a shortage (positive amount) when received is lower', () => {
    expect(cashDifference(50_000, 48_750)).toEqual({ kind: 'shortage', amount: 1_250 });
  });
  it('is an overage when received is higher', () => {
    expect(cashDifference(50_000, 51_000)).toEqual({ kind: 'overage', amount: 1_000 });
  });
  it('a zero received against a balance is a full shortage', () => {
    expect(cashDifference(7_500, 0)).toEqual({ kind: 'shortage', amount: 7_500 });
  });
});

describe('differenceLabel', () => {
  it('labels each kind in Arabic with the amount', () => {
    expect(differenceLabel({ kind: 'match', amount: 0 })).toBe('مطابق');
    expect(differenceLabel({ kind: 'shortage', amount: 1_250 })).toBe('نقص 1,250 د.ع');
    expect(differenceLabel({ kind: 'overage', amount: 1_000 })).toBe('زيادة 1,000 د.ع');
  });
});
