import { normalizeIraqiPhone, toStoredPhone } from '../phone';

describe('normalizeIraqiPhone', () => {
  it.each([
    ['07701234567', '+9647701234567'],
    ['7701234567', '+9647701234567'],
    ['+9647701234567', '+9647701234567'],
    ['009647701234567', '+9647701234567'],
    ['9647701234567', '+9647701234567'],
    ['0770 123 4567', '+9647701234567'],
    [' +964 770 123 4567 ', '+9647701234567'],
    ['0770-123-4567', '+9647701234567'],
    ['(0770) 1234567', '+9647701234567'],
    ['٠٧٧٠١٢٣٤٥٦٧', '+9647701234567'],
    ['۰۷۸۰۱۲۳۴۵۶۷', '+9647801234567'],
    ['07501234567', '+9647501234567'],
  ])('%p -> %p', (input, expected) => {
    expect(normalizeIraqiPhone(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['0770123456', 'too short'],
    ['077012345678', 'too long'],
    ['+96477012345', 'too short with country code'],
    ['08801234567', 'does not start with 7'],
    ['0612345678', 'landline'],
    ['+9657701234567', 'wrong country code'],
    ['0770123456a', 'letters'],
    ['+0770123456', 'plus without country code'],
  ])('rejects %p (%s)', (input) => {
    expect(normalizeIraqiPhone(input)).toBeNull();
  });
});

describe('toStoredPhone', () => {
  it('drops the plus, as Supabase Auth stores phones', () => {
    expect(toStoredPhone('+9647701234567')).toBe('9647701234567');
  });
});
