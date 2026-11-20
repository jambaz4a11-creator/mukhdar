// شاشة الدخول (SPEC-driver §2.2).
import { AUTH_MESSAGES, NETWORK_ERROR_MESSAGE } from '@mukhdar/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import LoginScreen from '../app/auth/login';
import { ar } from '../i18n/ar';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('../config', () => ({
  config: {
    supabaseUrl: 'https://x.supabase.co',
    supabaseKey: 'sb_publishable_x',
    shopPhone: '07801112222',
    shopWhatsapp: '9647801112222',
  },
  isSupabaseConfigured: () => true,
}));
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

async function setup(signIn: () => unknown = () => ({ data: { session: {} }, error: null })) {
  const auth = { signInWithPassword: jest.fn(() => Promise.resolve(signIn())) };
  mockClient = { auth };
  await renderScreen(<LoginScreen />);
  return auth;
}

async function fill(phone: string, pin: string) {
  await fireEvent.changeText(screen.getByTestId('phone-input'), phone);
  await fireEvent.changeText(screen.getByTestId('pin-input'), pin);
}

beforeEach(() => {
  mockParams = {};
  mockPush.mockClear();
});

it('signs in with E.164 and Latin digits (Arabic keyboard accepted)', async () => {
  const auth = await setup();
  expect(screen.getByTestId('login-submit')).toBeDisabled();
  await fill('٠٧٨٠ ١١١ ٢٢٢٢', '٤٨٢٩١٥');
  await fireEvent.press(screen.getByTestId('login-submit'));
  await waitFor(() =>
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647801112222',
      password: '482915',
    }),
  );
});

it.each([
  [{ code: 'invalid_credentials', status: 400 }, AUTH_MESSAGES.INVALID_CREDENTIALS],
  [{ status: 429 }, AUTH_MESSAGES.RATE_LIMITED],
  [{ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }, NETWORK_ERROR_MESSAGE],
])('shows the Arabic message for %p', async (error, message) => {
  await setup(() => ({ data: { session: null }, error }));
  await fill('07801112222', '482915');
  await fireEvent.press(screen.getByTestId('login-submit'));
  expect(await screen.findByText(message)).toBeTruthy();
});

it('"سجّل هنا" opens Register', async () => {
  await setup();
  await fireEvent.press(screen.getByText(ar.login.registerHere));
  expect(mockPush).toHaveBeenCalledWith('/auth/register');
});

it('forgot PIN: call and WhatsApp the shop', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await setup();
  await fill('07701234567', '');
  await fireEvent.press(screen.getByTestId('forgot-call'));
  expect(open).toHaveBeenCalledWith('tel:+9647801112222');
  await fireEvent.press(screen.getByTestId('forgot-whatsapp'));
  expect(open).toHaveBeenLastCalledWith(
    `https://wa.me/9647801112222?text=${encodeURIComponent('نسيت رمز الدخول، رقمي 07701234567')}`,
  );
});

it('notice after a registration finished earlier: "حسابك جاهز"', async () => {
  mockParams = { notice: 'ready' };
  await setup();
  expect(screen.getByText(ar.login.accountReady)).toBeTruthy();
});
