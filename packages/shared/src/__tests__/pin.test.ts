import { PIN_MESSAGES, isTrivialPin, normalizePin, phonePinCredentials, validatePin } from '../pin';

describe('normalizePin', () => {
  it('converts Arabic-Indic and Persian digits and strips spaces', () => {
    expect(normalizePin('٤٨٢ ٩١٥')).toBe('482915');
    expect(normalizePin('۴۸۲۹۱۵')).toBe('482915');
    expect(normalizePin('482915')).toBe('482915');
  });
});

describe('validatePin', () => {
  it('accepts a non-trivial 6-digit PIN (Latin or Arabic digits)', () => {
    expect(validatePin('482915')).toBeNull();
    expect(validatePin('٤٨٢٩١٥')).toBeNull();
    expect(validatePin('730514')).toBeNull();
  });

  it.each(['', '12345', '1234567', '48291a', '48-915', '4829 1'])(
    'rejects %p: not exactly 6 digits',
    (pin) => {
      expect(validatePin(pin)).toBe('PIN_LENGTH');
    },
  );

  it.each([
    // كل الأرقام متساوية
    '000000',
    '111111',
    '999999',
    // تسلسل متصاعد/متنازل
    '123456',
    '234567',
    '456789',
    '012345',
    '654321',
    '987654',
    '543210',
    // تكرار بدورة 2 أو 3
    '121212',
    '101010',
    '696969',
    '123123',
    '112112',
    '007007',
    // شائعة
    '112233',
    '123321',
    '159753',
    '147258',
    '٠٠٠٠٠٠',
  ])('rejects trivial %p', (pin) => {
    expect(validatePin(pin)).toBe('PIN_TRIVIAL');
  });

  it('rejects a PIN taken from the phone number', () => {
    expect(validatePin('345678', '07701345678')).toBe('PIN_TRIVIAL'); // السهولة تُفحص أولاً
    expect(validatePin('481935', '07701481935')).toBe('PIN_MATCHES_PHONE'); // آخر 6
    expect(validatePin('481935', '+9647701481935')).toBe('PIN_MATCHES_PHONE');
    expect(validatePin('770148', '07701481935')).toBe('PIN_MATCHES_PHONE'); // أول 6 وطنية
    expect(validatePin('482915', '07701481935')).toBeNull();
  });

  it('every error has an Arabic message', () => {
    for (const msg of Object.values(PIN_MESSAGES)) expect(msg).toMatch(/[؀-ۿ]/);
  });
});

describe('isTrivialPin', () => {
  it('does not flag ordinary PINs', () => {
    for (const pin of ['482915', '730514', '120934', '908172', '135792']) {
      expect(isTrivialPin(pin)).toBe(false);
    }
  });
});

describe('phonePinCredentials', () => {
  it('builds E.164 phone + Latin-digit PIN for Supabase Auth', () => {
    expect(phonePinCredentials('0770 123 4567', '٤٨٢٩١٥')).toEqual({
      phone: '+9647701234567',
      password: '482915',
    });
  });

  it('returns null for an invalid phone or a PIN that is not 6 digits', () => {
    expect(phonePinCredentials('0123', '482915')).toBeNull();
    expect(phonePinCredentials('07701234567', '4829')).toBeNull();
  });

  it('does not check triviality (old accounts must still sign in)', () => {
    expect(phonePinCredentials('07701234567', '123456')).not.toBeNull();
  });
});
