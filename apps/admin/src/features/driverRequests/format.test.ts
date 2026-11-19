import { describe, expect, it } from 'vitest';
import { NOTE_MAX, approveBlocked, decisionErrorMessage, sinceLabel, statusLabel } from './format';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('sinceLabel (منذ متى)', () => {
  it.each([
    [0, 'الآن'],
    [30_000, 'الآن'],
    [MIN, 'منذ دقيقة'],
    [2 * MIN, 'منذ دقيقتين'],
    [5 * MIN, 'منذ 5 دقائق'],
    [59 * MIN, 'منذ 59 دقيقة'],
    [HOUR, 'منذ ساعة'],
    [2 * HOUR, 'منذ ساعتين'],
    [10 * HOUR, 'منذ 10 ساعات'],
    [23 * HOUR, 'منذ 23 ساعة'],
    [DAY, 'منذ يوم'],
    [2 * DAY, 'منذ يومين'],
    [6 * DAY, 'منذ 6 أيام'],
    [11 * DAY, 'منذ 11 يوماً'],
  ])('%i ms -> %s', (ms, label) => {
    expect(sinceLabel(ago(ms), NOW)).toBe(label);
  });

  it('a clock slightly ahead of the server is "now", never negative', () => {
    expect(sinceLabel(new Date(NOW + 5 * MIN).toISOString(), NOW)).toBe('الآن');
  });

  it('invalid date is an empty string', () => {
    expect(sinceLabel('not-a-date', NOW)).toBe('');
  });
});

describe('statusLabel', () => {
  it.each([
    ['pending', 'بانتظار الموافقة'],
    ['approved', 'موافَق عليه'],
    ['rejected', 'مرفوض'],
    ['completed', 'اكتمل التسجيل'],
    ['expired', 'منتهية'],
  ])('%s -> %s', (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });

  it('unknown status is shown as is, not hidden', () => {
    expect(statusLabel('weird')).toBe('weird');
  });
});

describe('approveBlocked (الموافقة تحتاج خانة "اتصلت وتأكدت")', () => {
  it('blocked until the box is ticked', () => {
    expect(approveBlocked(false)).toBe(true);
    expect(approveBlocked(true)).toBe(false);
  });
});

describe('decisionErrorMessage', () => {
  it('REQUEST_ALREADY_DECIDED asks for a refresh', () => {
    expect(decisionErrorMessage({ message: 'REQUEST_ALREADY_DECIDED' })).toEqual({
      message: 'هذا الطلب انحسم قبل، حدّث الصفحة',
      refresh: true,
    });
  });

  it('PHONE_TAKEN points to the staff page (not the signup wording)', () => {
    const r = decisionErrorMessage({ message: 'PHONE_TAKEN' });
    expect(r.message).toBe('الرقم صار له حساب. رقّيه كسائق من صفحة الموظفين (بعد إعادة ضبط رمزه)');
    expect(r.refresh).toBe(false);
  });

  it('REQUEST_NOT_FOUND refreshes too (the request was cleaned up)', () => {
    expect(decisionErrorMessage({ message: 'REQUEST_NOT_FOUND' }).refresh).toBe(true);
  });

  it('anything else is the generic Arabic message, never raw text', () => {
    const r = decisionErrorMessage({ message: 'relation "x" does not exist' });
    expect(r.message).not.toContain('relation');
    expect(r.refresh).toBe(false);
  });
});

describe('NOTE_MAX', () => {
  it('matches the database limit (300)', () => {
    expect(NOTE_MAX).toBe(300);
  });
});
