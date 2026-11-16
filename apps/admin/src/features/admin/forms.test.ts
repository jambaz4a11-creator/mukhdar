import { generatePin, validatePin } from '@mukhdar/shared';
import { describe, expect, it } from 'vitest';
import {
  compactRanges,
  parseBuildingNumbers,
  pinMessage,
  resetPinFailure,
  splitNew,
  validateBuildingNumber,
  validateSettings,
  type SettingsValues,
} from './forms';

describe('parseBuildingNumbers (bulk building add)', () => {
  it('"1-100" gives 1..100', () => {
    const r = parseBuildingNumbers('1-100');
    expect(r.error).toBeNull();
    expect(r.numbers).toHaveLength(100);
    expect(r.numbers[0]).toBe('1');
    expect(r.numbers[99]).toBe('100');
  });

  it('"1,2,5-9" gives a mixed list', () => {
    expect(parseBuildingNumbers('1,2,5-9')).toEqual({
      numbers: ['1', '2', '5', '6', '7', '8', '9'],
      error: null,
    });
  });

  it('accepts spaces, new lines, the Arabic comma, Arabic digits and an en dash', () => {
    expect(parseBuildingNumbers(' ٣ ، 1\n2  10 – 12 ').numbers).toEqual([
      '1',
      '2',
      '3',
      '10',
      '11',
      '12',
    ]);
  });

  it('removes duplicates and overlapping ranges, sorted', () => {
    expect(parseBuildingNumbers('5, 1-3, 2, 3-6').numbers).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it.each([
    ['', 'اكتب أرقام العمارات'],
    ['   ', 'اكتب أرقام العمارات'],
    ['12a', 'ليس رقماً'],
    ['1-', 'ليس رقماً'],
    ['-5', 'ليس رقماً'],
    ['1-2-3', 'ليس رقماً'],
    ['0', 'من 1 إلى'],
    ['101', 'من 1 إلى 100'],
    ['10000', 'من 1 إلى 100'],
    ['9-5', 'مقلوب'],
    ['1-101', 'من 1 إلى 100'],
    ['1-300, 400-700', 'من 1 إلى 100'],
    ['1.5', 'ليس رقماً'],
  ])('rejects %p', (input, message) => {
    const r = parseBuildingNumbers(input);
    expect(r.numbers).toEqual([]);
    expect(r.error).toContain(message);
  });

  it('accepts exactly 1-100 (the DB format check allows nothing above 100)', () => {
    expect(parseBuildingNumbers('1-100').numbers).toHaveLength(100);
  });
});

describe('splitNew / compactRanges (preview)', () => {
  it('separates existing buildings (ignored) from new ones', () => {
    expect(splitNew(['1', '2', '3', '4'], ['2', '4', '99'])).toEqual({
      fresh: ['1', '3'],
      duplicates: ['2', '4'],
    });
  });

  it('shows long lists as ranges', () => {
    expect(compactRanges(['1', '2', '3', '5', '7', '8'])).toBe('1-3، 5، 7-8');
    expect(compactRanges([])).toBe('');
  });
});

describe('validateSettings', () => {
  const base: SettingsValues = {
    delivery_fee_iqd: '1000',
    min_order_iqd: '0',
    max_active_orders: '3',
    store_open: true,
    closed_message: '',
  };

  it('valid values give the RPC payload (blank message → null)', () => {
    expect(validateSettings({ ...base, closed_message: '  نرجع 8 الصبح ' })).toEqual({
      payload: {
        delivery_fee_iqd: 1000,
        min_order_iqd: 0,
        max_active_orders: 3,
        store_open: true,
        closed_message: 'نرجع 8 الصبح',
      },
      errors: null,
    });
    expect(validateSettings(base).payload?.closed_message).toBeNull();
  });

  it('minimum order 1100 is rejected (multiple of 250)', () => {
    expect(validateSettings({ ...base, min_order_iqd: '1100' }).errors?.min_order_iqd).toContain(
      'مضاعفات 250',
    );
    expect(validateSettings({ ...base, min_order_iqd: '1250' }).errors).toBeNull();
  });

  it('accepts Arabic digits and thousands separators', () => {
    expect(validateSettings({ ...base, delivery_fee_iqd: '١,٥٠٠' }).payload?.delivery_fee_iqd).toBe(
      1500,
    );
  });

  it.each([
    [{ delivery_fee_iqd: '900' }, 'delivery_fee_iqd'],
    [{ delivery_fee_iqd: '' }, 'delivery_fee_iqd'],
    [{ delivery_fee_iqd: '-250' }, 'delivery_fee_iqd'],
    [{ min_order_iqd: 'abc' }, 'min_order_iqd'],
    [{ max_active_orders: '0' }, 'max_active_orders'],
    [{ max_active_orders: '1001' }, 'max_active_orders'],
    [{ max_active_orders: '2.5' }, 'max_active_orders'],
    [{ closed_message: 'x'.repeat(201) }, 'closed_message'],
  ] as const)('rejects %p', (patch, field) => {
    const r = validateSettings({ ...base, ...patch });
    expect(r.payload).toBeNull();
    expect(r.errors).toHaveProperty(field);
  });
});

describe('PIN helpers used by the staff screen', () => {
  it('random PINs pass validatePin for the target phone', () => {
    for (let i = 0; i < 200; i++) {
      const pin = generatePin('9647701234567');
      expect(validatePin(pin, '9647701234567')).toBeNull();
    }
  });

  it('WhatsApp messages carry the PIN', () => {
    expect(pinMessage('reset', '482915')).toContain('482915');
    expect(pinMessage('create', '482915')).toContain('رمزك المؤقت: 482915');
  });
});

describe('validateBuildingNumber', () => {
  it.each(['1', '9', '10', '57', '100', '٥٧'])('accepts %p', (input) => {
    expect(validateBuildingNumber(input)).toBeNull();
  });
  it.each(['', '0', '101', '012', '1000', '12a', '1.5', '-3'])('rejects %p', (input) => {
    expect(validateBuildingNumber(input)).toContain('من 1 إلى 100');
  });
});

describe('resetPinFailure (admin-reset-pin errors)', () => {
  const coded = (code: string) => Object.assign(new Error('x'), { code });

  it('RESET_INCOMPLETE clears the PIN and says not to send it', () => {
    const r = resetPinFailure(coded('RESET_INCOMPLETE'));
    expect(r.clearPin).toBe(true);
    expect(r.message).toContain('ولا ترسل الرمز');
  });

  it('an unknown outcome (internal error, network, no code) is treated like incomplete', () => {
    for (const e of [coded('INTERNAL'), new Error('Failed to fetch'), null]) {
      const r = resetPinFailure(e);
      expect(r.clearPin).toBe(true);
      expect(r.message).toContain('ولا ترسل الرمز');
    }
  });

  it('a rejection before any change keeps the PIN and shows the specific reason', () => {
    const r = resetPinFailure(coded('TOO_MANY_RESETS'));
    expect(r.clearPin).toBe(false);
    expect(r.message).toContain('20');
    expect(resetPinFailure(coded('PIN_INVALID')).clearPin).toBe(false);
  });

  it('reads a code from a raw backend body too', () => {
    expect(resetPinFailure({ error: 'RESET_INCOMPLETE' }).clearPin).toBe(true);
    expect(resetPinFailure({ error: 'NOT_ALLOWED' }).clearPin).toBe(false);
  });
});
