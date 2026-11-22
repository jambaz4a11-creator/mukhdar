import { formatElapsedAr } from '../elapsed';

const H = 60;
const D = 24 * H;

describe('formatElapsedAr', () => {
  it.each([
    [0, ''],
    [0.9, ''],
    [-5, ''],
    [Number.NaN, ''],
    [Number.POSITIVE_INFINITY, ''],
    [1, 'دقيقة'],
    [2, 'دقيقتين'],
    [3, '3 دقائق'],
    [10, '10 دقائق'],
    [11, '11 دقيقة'],
    [59, '59 دقيقة'],
    [59.9, '59 دقيقة'],
    [H, 'ساعة'],
    [H + 59, 'ساعة'],
    [2 * H, 'ساعتين'],
    [3 * H, '3 ساعات'],
    [10 * H, '10 ساعات'],
    [11 * H, '11 ساعة'],
    [23 * H + 59, '23 ساعة'],
    [D, 'يوم'],
    [2 * D, 'يومين'],
    [4 * D, '4 أيام'],
    [10 * D, '10 أيام'],
    [11 * D, '11 يوم'],
    [400 * D, '400 يوم'],
  ])('%p minutes -> %p', (minutes, expected) => {
    expect(formatElapsedAr(minutes)).toBe(expected);
  });

  it('the bug report: 6391 minutes reads as days, not minutes', () => {
    expect(formatElapsedAr(6391)).toBe('4 أيام');
  });
});
