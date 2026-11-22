import { describe, expect, it } from 'vitest';
import { STAFF_HISTORY_NOTE, basisLabel, heldNowLine, lastHandoverLine, oldestLine } from './text';

describe('basisLabel (SPEC-cash §4: inclusive / exclusive of the delivery fee)', () => {
  it('true = includes the fee', () => {
    expect(basisLabel(true)).toBe('شامل أجرة التوصيل');
  });
  it('false = goods only, fee stays with the driver', () => {
    expect(basisLabel(false)).toBe('بدون أجرة التوصيل (تبقى عند السائق)');
  });
});

describe('heldNowLine', () => {
  it('formats the header total and the driver count', () => {
    expect(heldNowLine(125_000, 3)).toBe('الكاش عند السواق الآن: 125,000 د.ع (3 سائق)');
    expect(heldNowLine(0, 0)).toBe('الكاش عند السواق الآن: 0 د.ع (0 سائق)');
  });
});

describe('oldestLine', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  it('shows the age of the oldest unhanded delivery', () => {
    expect(oldestLine('2026-11-22T09:00:00Z', now)).toBe('أقدم توصيل من 3 ساعات');
    expect(oldestLine('2026-11-20T12:00:00Z', now)).toBe('أقدم توصيل من يومين');
    expect(oldestLine('2026-11-22T11:00:00Z', now)).toBe('أقدم توصيل من ساعة');
  });
  it('under a minute reads as "now"; no date reads as nothing', () => {
    expect(oldestLine('2026-11-22T11:59:40Z', now)).toBe('أقدم توصيل: هسه');
    expect(oldestLine(null, now)).toBe('');
  });
});

describe('lastHandoverLine', () => {
  it('says there is no previous handover', () => {
    expect(lastHandoverLine(null, null, null)).toBe('ما سلّم كاش بعد');
  });
  it('shows the amount and a difference text', () => {
    const l = lastHandoverLine('2026-11-22T09:00:00Z', 48_750, -1_250);
    expect(l).toContain('48,750');
    expect(l).toContain('نقص 1,250');
    expect(lastHandoverLine('2026-11-22T09:00:00Z', 50_000, 0)).not.toContain('نقص');
    expect(lastHandoverLine('2026-11-22T09:00:00Z', 51_000, 1_000)).toContain('زيادة 1,000');
  });
});

describe('staff history note', () => {
  it('states the 7-day limit', () => {
    expect(STAFF_HISTORY_NOTE).toBe('يظهر لك سجل آخر 7 أيام فقط. الأقدم عند المدير.');
  });
});
