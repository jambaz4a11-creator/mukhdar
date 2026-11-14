// RNTL (T10): شاشات الدخول والتسجيل والاسم، الحارس، وتسجيل الخروج. Supabase مزيف، بلا شبكة.
import { AUTH_MESSAGES, PIN_MESSAGES } from '@mukhdar/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AccountScreen from '../app/(tabs)/account';
import OrdersScreen from '../app/(tabs)/orders';
import NameScreen from '../app/auth/name';
import SignInScreen from '../app/auth/sign-in';
import SignUpScreen from '../app/auth/sign-up';
import { useAuth } from '../features/auth/store';
import { useCart } from '../features/cart/store';
import { ar } from '../i18n/ar';
import { createFakeSupabase, opArgs, type Call, type Result } from '../test-utils/fakeSupabase';

// ------------------------------------------------------------------ mocks
let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('../config', () => ({
  config: {
    supabaseUrl: 'https://x.supabase.co',
    supabaseKey: 'sb_publishable_x',
    sentryDsn: '',
    shopWhatsapp: '9647801112222',
  },
  isSupabaseConfigured: () => true,
}));
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
let mockPathname = '/';
jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
  usePathname: () => mockPathname,
}));

const SESSION = { user: { id: 'u1', phone: '9647701234567' }, access_token: 't' };

interface FakeOptions {
  signIn?: () => { data: unknown; error: unknown };
  invoke?: () => { data: unknown; error: unknown };
  fullName?: string | null;
}

function setup(opts: FakeOptions = {}) {
  const fake = createFakeSupabase((call: Call): Result => {
    if (call.table === 'profiles' && opArgs(call, 'update')) return { data: null, error: null };
    if (call.table === 'profiles')
      return { data: { full_name: opts.fullName ?? null }, error: null };
    return { data: null, error: null };
  });
  const auth = {
    signInWithPassword: jest.fn(() =>
      Promise.resolve(opts.signIn?.() ?? { data: { session: SESSION }, error: null }),
    ),
    signOut: jest.fn(() => {
      useAuth.setState({ session: null });
      return Promise.resolve({ error: null });
    }),
    signUp: jest.fn(),
    signInWithOtp: jest.fn(),
  };
  const functions = {
    invoke: jest.fn(() =>
      Promise.resolve(opts.invoke?.() ?? { data: { created: true }, error: null }),
    ),
  };
  mockClient = { ...fake.client, auth, functions };
  return { auth, functions, calls: fake.calls };
}

const httpError = (code: string, status: number) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: () => Promise.resolve({ error: code }) },
});

async function renderScreen(ui: ReactElement) {
  return await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {ui}
    </SafeAreaProvider>,
  );
}

const isDisabled = (testID: string) =>
  screen.getByTestId(testID).props.accessibilityState?.disabled === true;

async function type(testID: string, text: string) {
  await fireEvent.changeText(screen.getByTestId(testID), text);
}

beforeEach(() => {
  mockReplace.mockReset();
  mockParams = {};
  mockPathname = '/';
  useAuth.setState({ session: null, ready: true });
  useCart.setState({ items: {} });
});

// ------------------------------------------------------------------ sign in
describe('sign in', () => {
  it('button disabled until the phone is valid and the PIN has 6 digits', async () => {
    setup();
    await renderScreen(<SignInScreen />);
    expect(isDisabled('sign-in-submit')).toBe(true);
    await type('phone-input', '0770 123');
    await type('pin-input', '482915');
    expect(isDisabled('sign-in-submit')).toBe(true);
    await type('phone-input', '0770 123 4567');
    await type('pin-input', '48291');
    expect(isDisabled('sign-in-submit')).toBe(true);
    await type('pin-input', '482915');
    expect(isDisabled('sign-in-submit')).toBe(false);
  });

  it('wrong number or PIN → "الرقم أو الرمز غير صحيح"', async () => {
    const { auth } = setup({
      signIn: () => ({
        data: { session: null },
        error: { name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'x' },
      }),
    });
    await renderScreen(<SignInScreen />);
    await type('phone-input', '07701234567');
    await type('pin-input', '482915');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(await screen.findByText('الرقم أو الرمز غير صحيح')).toBeTruthy();
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('Arabic digits are sent as Latin (E.164 phone + Latin PIN)', async () => {
    const { auth } = setup({ fullName: 'أحمد' });
    await renderScreen(<SignInScreen />);
    await type('phone-input', '٠٧٧٠ ١٢٣ ٤٥٦٧');
    await type('pin-input', '٤٨٢٩١٥');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647701234567',
      password: '482915',
    });
  });

  it('returns to the original screen when the name is set', async () => {
    mockParams = { redirect: '/orders' };
    setup({ fullName: 'أحمد' });
    await renderScreen(<SignInScreen />);
    await type('phone-input', '07701234567');
    await type('pin-input', '482915');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/orders'));
  });

  it('first time (no name) → name screen, carrying the redirect', async () => {
    mockParams = { redirect: '/account' };
    setup({ fullName: null });
    await renderScreen(<SignInScreen />);
    await type('phone-input', '07701234567');
    await type('pin-input', '482915');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/auth/name',
        params: { redirect: '/account' },
      }),
    );
  });

  it('show/hide PIN toggles the secure entry', async () => {
    setup();
    await renderScreen(<SignInScreen />);
    expect(screen.getByTestId('pin-input').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByLabelText(ar.auth.showPin));
    expect(screen.getByTestId('pin-input').props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText(ar.auth.hidePin)).toBeTruthy();
  });

  it('"forgot PIN?" opens the shop WhatsApp with the customer number', async () => {
    setup();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await renderScreen(<SignInScreen />);
    await type('phone-input', '07701234567');
    await fireEvent.press(screen.getByText(ar.auth.forgotPin));
    expect(open).toHaveBeenCalledWith(
      `https://wa.me/9647801112222?text=${encodeURIComponent('نسيت رمز الدخول، رقمي 07701234567')}`,
    );
  });

  it('shows the "number registered" notice when sent here from sign-up', async () => {
    mockParams = { phone: '07701234567', notice: 'phone_taken' };
    setup();
    await renderScreen(<SignInScreen />);
    expect(screen.getByText(AUTH_MESSAGES.PHONE_TAKEN)).toBeTruthy();
    expect(screen.getByTestId('phone-input').props.value).toBe('07701234567');
  });
});

// ------------------------------------------------------------------ sign up
describe('sign up', () => {
  async function fill(phone: string, pin: string, confirm = pin) {
    await type('phone-input', phone);
    await type('pin-input', pin);
    await type('pin-confirm-input', confirm);
  }

  it('an easy PIN (123456) is refused in Arabic before any network request', async () => {
    const { functions, auth } = setup();
    await renderScreen(<SignUpScreen />);
    await fill('07701234567', '123456');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(screen.getByText(PIN_MESSAGES.PIN_TRIVIAL)).toBeTruthy();
    expect(functions.invoke).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('confirmation PIN that does not match', async () => {
    const { functions } = setup();
    await renderScreen(<SignUpScreen />);
    await fill('07701234567', '482915', '482916');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(screen.getByText(ar.auth.pinMismatch)).toBeTruthy();
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it('button disabled for an invalid phone or a short PIN', async () => {
    setup();
    await renderScreen(<SignUpScreen />);
    await fill('0612345678', '482915');
    expect(isDisabled('sign-up-submit')).toBe(true);
    await fill('07701234567', '4829', '4829');
    expect(isDisabled('sign-up-submit')).toBe(true);
  });

  it('creates the account via the signup function (Arabic digits → Latin), signs in, then asks the name', async () => {
    mockParams = { redirect: '/checkout' };
    const { functions, auth } = setup();
    await renderScreen(<SignUpScreen />);
    await fill('٠٧٧٠١٢٣٤٥٦٧', '٤٨٢٩١٥');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/auth/name',
        params: { redirect: '/checkout' },
      }),
    );
    expect(functions.invoke).toHaveBeenCalledWith('signup', {
      body: { phone: '+9647701234567', pin: '482915' },
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647701234567',
      password: '482915',
    });
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('registered number (PHONE_TAKEN) → sign-in mode with the same number', async () => {
    mockParams = { redirect: '/orders' };
    const { auth } = setup({
      invoke: () => ({ data: null, error: httpError('PHONE_TAKEN', 409) }),
    });
    await renderScreen(<SignUpScreen />);
    await fill('07701234567', '482915');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/auth/sign-in',
        params: { redirect: '/orders', phone: '07701234567', notice: 'phone_taken' },
      }),
    );
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('rate limited by the server → Arabic message, stays on the screen', async () => {
    setup({ invoke: () => ({ data: null, error: httpError('RATE_LIMITED', 429) }) });
    await renderScreen(<SignUpScreen />);
    await fill('07701234567', '482915');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(await screen.findByText(AUTH_MESSAGES.RATE_LIMITED)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ name, guard, sign out
describe('name screen', () => {
  it('saves the trimmed name to profiles and returns to the redirect', async () => {
    useAuth.setState({ session: SESSION as never, ready: true });
    mockParams = { redirect: '/orders' };
    const { calls } = setup();
    await renderScreen(<NameScreen />);
    expect(isDisabled('name-submit')).toBe(true);
    await type('name-input', '  أحمد   علي ');
    await fireEvent.press(screen.getByTestId('name-submit'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/orders'));
    const update = calls.find((c) => opArgs(c, 'update'));
    expect(opArgs(update as Call, 'update')).toEqual([{ full_name: 'أحمد علي' }]);
    expect(opArgs(update as Call, 'eq')).toEqual(['id', 'u1']);
  });
});

describe('guard', () => {
  it('a protected screen without a session → sign-in, remembering where the user was', async () => {
    mockPathname = '/orders';
    setup();
    await renderScreen(<OrdersScreen />);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/auth/sign-in',
      params: { redirect: '/orders' },
    });
    expect(screen.queryByText(ar.placeholders.orders)).toBeNull();
  });

  it('waits for the saved session before redirecting', async () => {
    useAuth.setState({ session: null, ready: false });
    setup();
    await renderScreen(<OrdersScreen />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('with a session the screen shows', async () => {
    useAuth.setState({ session: SESSION as never, ready: true });
    setup();
    await renderScreen(<OrdersScreen />);
    expect(screen.getByText(ar.placeholders.orders)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('sign out', () => {
  it('clears the session and keeps the cart', async () => {
    useAuth.setState({ session: SESSION as never, ready: true });
    useCart.setState({ items: { t: 2 } });
    const { auth } = setup();
    await renderScreen(<AccountScreen />);
    expect(screen.getByText('07701234567')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('sign-out'));
    });
    expect(auth.signOut).toHaveBeenCalled();
    expect(useAuth.getState().session).toBeNull();
    expect(useCart.getState().items).toEqual({ t: 2 });
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});
