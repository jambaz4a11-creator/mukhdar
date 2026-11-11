import { formatIQD, isValidPrice, roundIQD } from '../money';

describe('roundIQD (same as public.round_iqd)', () => {
  it.each([
    [0, 0],
    [124, 0],
    [125, 250],
    [249, 250],
    [250, 250],
    [374, 250],
    [375, 500],
    [1125, 1250],
    [1375, 1500],
    [999_999_875, 1_000_000_000],
    [9_007_199_254_740_000, 9_007_199_254_740_000],
  ])('roundIQD(%p) = %p', (input, expected) => {
    expect(roundIQD(input)).toBe(expected);
  });

  it('matches the SQL formula ((n + 125) / 250) * 250 with integer division', () => {
    for (let n = 0; n <= 5000; n++) {
      expect(roundIQD(n)).toBe(Math.trunc((n + 125) / 250) * 250);
    }
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    'rejects %p',
    (bad) => {
      expect(() => roundIQD(bad)).toThrow(RangeError);
    },
  );
});

describe('formatIQD', () => {
  it.each([
    [0, '0 د.ع'],
    [250, '250 د.ع'],
    [1000, '1,000 د.ع'],
    [12_500, '12,500 د.ع'],
    [1_234_567, '1,234,567 د.ع'],
    [-1500, '-1,500 د.ع'],
  ])('formatIQD(%p) = %p', (input, expected) => {
    expect(formatIQD(input)).toBe(expected);
  });

  it('uses Latin digits only', () => {
    expect(formatIQD(9_876_543)).toMatch(/^[0-9,]+ د\.ع$/);
  });

  it('rejects non-finite numbers', () => {
    expect(() => formatIQD(Number.NaN)).toThrow(RangeError);
  });
});

describe('isValidPrice (same as the products.price_iqd check)', () => {
  it.each([250, 500, 1250, 100_000])('accepts %p', (p) => {
    expect(isValidPrice(p)).toBe(true);
  });
  it.each([0, -250, 100, 1249, 250.5, Number.NaN])('rejects %p', (p) => {
    expect(isValidPrice(p)).toBe(false);
  });
});
