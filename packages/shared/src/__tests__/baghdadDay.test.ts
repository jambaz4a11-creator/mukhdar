// baghdadDayRange: اليوم = [00:00, 24:00) بتوقيت Asia/Baghdad (UTC+3 ثابت)؛ يطابق public.baghdad_today() بقاعدة البيانات.
import { baghdadDayRange, sumCash } from '../baghdadDay';

describe('baghdadDayRange', () => {
  it('a mid-day instant gives that Baghdad day', () => {
    expect(baghdadDayRange(Date.parse('2026-11-20T10:00:00Z'))).toEqual({
      from: '2026-11-19T21:00:00.000Z',
      to: '2026-11-20T21:00:00.000Z',
    });
  });
  it('23:59 Baghdad (20:59Z) is still the same day', () => {
    const r = baghdadDayRange(Date.parse('2026-11-20T20:59:00Z'));
    expect(r.from).toBe('2026-11-19T21:00:00.000Z');
    expect(r.to).toBe('2026-11-20T21:00:00.000Z');
  });
  it('00:01 Baghdad (21:01Z) is the next day', () => {
    const r = baghdadDayRange(Date.parse('2026-11-20T21:01:00Z'));
    expect(r.from).toBe('2026-11-20T21:00:00.000Z');
    expect(r.to).toBe('2026-11-21T21:00:00.000Z');
  });
  it('exact midnight Baghdad belongs to the new day (from is inclusive, to exclusive)', () => {
    const r = baghdadDayRange(Date.parse('2026-11-20T21:00:00Z'));
    expect(r.from).toBe('2026-11-20T21:00:00.000Z');
  });
  it('accepts a Date and defaults to now', () => {
    expect(baghdadDayRange(new Date('2026-11-20T10:00:00Z')).from).toBe('2026-11-19T21:00:00.000Z');
    const r = baghdadDayRange();
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(86_400_000);
  });
});

describe('sumCash', () => {
  it('sums total_iqd (delivery fee included: the driver collects the whole total)', () => {
    expect(sumCash([{ total_iqd: 8250 }, { total_iqd: 12500 }])).toBe(20750);
    expect(sumCash([])).toBe(0);
  });
});
