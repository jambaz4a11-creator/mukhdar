import { displayPhone, forgotPinWhatsappUrl, telUrl, whatsappUrl } from '../contact';

describe('contact links (customer and driver apps)', () => {
  it('whatsappUrl: shop number in any format, null when unset or a placeholder', () => {
    expect(whatsappUrl('')).toBeNull();
    expect(whatsappUrl('9647XXXXXXXXX')).toBeNull();
    expect(whatsappUrl('+964 770 123 4567')).toBe('https://wa.me/9647701234567');
  });

  it('telUrl: Iraqi mobile becomes +964..., landline digits kept, junk refused', () => {
    expect(telUrl('')).toBeNull();
    expect(telUrl('0770 123 4567')).toBe('tel:+9647701234567');
    expect(telUrl('9647701234567')).toBe('tel:+9647701234567');
    expect(telUrl('017181234')).toBe('tel:017181234');
    expect(telUrl('abc')).toBeNull();
  });

  it('forgotPinWhatsappUrl: ready message with the user number when valid', () => {
    expect(forgotPinWhatsappUrl('+964 780 111 2222', '٠٧٧٠ ١٢٣ ٤٥٦٧')).toBe(
      `https://wa.me/9647801112222?text=${encodeURIComponent('نسيت رمز الدخول، رقمي 07701234567')}`,
    );
    expect(forgotPinWhatsappUrl('9647801112222', '')).toBe(
      `https://wa.me/9647801112222?text=${encodeURIComponent('نسيت رمز الدخول')}`,
    );
    expect(forgotPinWhatsappUrl('', '07701234567')).toBeNull();
  });

  it('displayPhone: stored 9647... shows as 07...', () => {
    expect(displayPhone('9647701234567')).toBe('07701234567');
    expect(displayPhone('+9647701234567')).toBe('07701234567');
    expect(displayPhone(null)).toBe('');
    expect(displayPhone('123')).toBe('');
  });
});
