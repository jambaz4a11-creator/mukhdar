// حسابي (T15): الشاشة (الاسم، الروابط المخفية حتى تُضبط)، حذف الحساب (تأكيدان، ACTIVE_ORDER، النجاح يفرّغ
// التخزين ويرجع للرئيسية)، تغيير الرمز (حالي خاطئ، جديد سهل، نجاح بأرقام لاتينية)، وتعديل الاسم.
// Supabase مزيف (from/auth/functions)، بلا شبكة.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ERROR_MESSAGES, PIN_MESSAGES } from '@mukhdar/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../test-utils/queryClient';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert, type AlertButton, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AccountScreen from '../app/(tabs)/account';
import EditNameScreen from '../app/account/name';
import ChangePinScreen from '../app/account/pin';
import { httpsUrl, LOCAL_DATA_KEYS, telUrl, whatsappUrl } from '../features/account/api';
import { useSelectedAddress } from '../features/addresses/selected';
import { useAuth } from '../features/auth/store';
import { useCart } from '../features/cart/store';
import { useOrderAttempt } from '../features/checkout/usePlaceOrder';
import { ar } from '../i18n/ar';
import { type Call, createFakeSupabase, opArgs, type Result } from '../test-utils/fakeSupabase';

// ------------------------------------------------------------------ mocks
let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('../config', () => ({
  config: {
    supabaseUrl: 'https://x.supabase.co',
    supabaseKey: 'k',
    sentryDsn: '',
    shopWhatsapp: '',
    shopPhone: '',
    privacyUrl: '',
    termsUrl: '',
  },
  isSupabaseConfigured: () => true,
}));
const mockConfig = jest.requireMock<{ config: Record<string, string> }>('../config').config;
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockRouter.push(...a),
    replace: (...a: unknown[]) => mockRouter.replace(...a),
    back: (...a: unknown[]) => mockRouter.back(...a),
    navigate: (...a: unknown[]) => mockRouter.navigate(...a),
    canGoBack: () => mockRouter.canGoBack(),
  },
  useLocalSearchParams: () => mockSearchParams,
  usePathname: () => '/account',
}));

let mockSearchParams: Record<string, string> = {};
const SESSION = { user: { id: 'u1', phone: '9647701234567' }, access_token: 't' };

/** خطأ FunctionsHttpError كما يرجعه supabase-js: الجسم بـ context (Response). */
function functionError(code: string) {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify({ error: code }), { status: 409 }),
  };
}

interface Options {
  fullName?: string | null;
  /** يؤخر رد الاسم حتى يُحَل (حالة التحميل) */
  profileGate?: Promise<void>;
  invoke?: () => { data: unknown; error: unknown };
  signIn?: () => { data: unknown; error: unknown };
  updateUser?: () => { data: unknown; error: unknown };
}

function setup(opts: Options = {}) {
  const fake = createFakeSupabase((call: Call): Result => {
    if (call.table === 'profiles' && opArgs(call, 'maybeSingle')) {
      const result = {
        data: { full_name: opts.fullName === undefined ? 'أحمد' : opts.fullName },
        error: null,
      };
      // resolve يقبل Promise فعلياً (يُسلسل بـ then)
      return (opts.profileGate ? opts.profileGate.then(() => result) : result) as Result;
    }
    if (call.table === 'addresses') return { data: [], error: null };
    return { data: null, error: null };
  });
  const auth = {
    signInWithPassword: jest.fn(() =>
      Promise.resolve(
        opts.signIn?.() ?? { data: { session: SESSION, user: SESSION.user }, error: null },
      ),
    ),
    updateUser: jest.fn(() =>
      Promise.resolve(opts.updateUser?.() ?? { data: { user: SESSION.user }, error: null }),
    ),
    signOut: jest.fn((opts?: { scope?: string }) => {
      // scope 'others' يبطل الأجهزة الأخرى فقط: جلسة هذا الجهاز تبقى
      if (opts?.scope !== 'others') useAuth.setState({ session: null, ready: true });
      return Promise.resolve({ error: null });
    }),
  };
  const functions = {
    invoke: jest.fn(() =>
      Promise.resolve(opts.invoke?.() ?? { data: { deleted: true }, error: null }),
    ),
  };
  mockClient = { ...fake.client, auth, functions };
  return { auth, functions, calls: fake.calls };
}

async function renderUi(ui: ReactElement) {
  const client = createTestQueryClient();
  renderedClient = client;
  return await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>,
  );
}

let renderedClient: ReturnType<typeof createTestQueryClient>;
let alertSpy: jest.SpyInstance;
let openSpy: jest.SpyInstance;

function pressAlertButton(text: string) {
  const buttons = (alertSpy.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  const button = buttons.find((b) => b.text === text);
  if (!button) throw new Error(`no alert button "${text}"`);
  button.onPress?.();
}

beforeEach(async () => {
  Object.values(mockRouter).forEach((f) => f.mockClear());
  mockRouter.canGoBack.mockReturnValue(true);
  Object.assign(mockConfig, { shopWhatsapp: '', shopPhone: '', privacyUrl: '', termsUrl: '' });
  useAuth.setState({ session: SESSION as never, ready: true });
  useCart.setState({ items: {}, flags: {} });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await AsyncStorage.clear();
});

afterEach(() => {
  alertSpy.mockRestore();
  openSpy.mockRestore();
});

// ------------------------------------------------------------------ وحدات
describe('contact and legal links', () => {
  it('whatsapp, tel and https helpers reject empty or invalid values', () => {
    expect(whatsappUrl('')).toBeNull();
    expect(whatsappUrl('9647XXXXXXXXX')).toBeNull(); // القيمة الوهمية بـ .env.example
    expect(whatsappUrl('+964 770 123 4567')).toBe('https://wa.me/9647701234567');
    expect(telUrl('')).toBeNull();
    expect(telUrl('0770 123 4567')).toBe('tel:+9647701234567');
    expect(telUrl('9647701234567')).toBe('tel:+9647701234567');
    expect(telUrl('abc')).toBeNull();
    expect(httpsUrl('')).toBeNull();
    expect(httpsUrl('http://x.com/privacy')).toBeNull();
    expect(httpsUrl('javascript:alert(1)')).toBeNull();
    expect(httpsUrl('https://admin.mukhdar.test/privacy')).toBe(
      'https://admin.mukhdar.test/privacy',
    );
  });
});

// ------------------------------------------------------------------ شاشة حسابي
describe('account screen', () => {
  it('shows the name and phone; contact and legal rows hidden until configured', async () => {
    setup();
    await renderUi(<AccountScreen />);
    expect(await screen.findByText('أحمد')).toBeTruthy();
    expect(screen.getByTestId('account-phone')).toHaveTextContent('07701234567');
    for (const id of ['whatsapp', 'call', 'privacy', 'terms']) {
      expect(screen.queryByTestId(`account-${id}`)).toBeNull();
    }
    expect(screen.getByTestId('account-pin')).toBeTruthy();
    expect(screen.getByTestId('delete-account')).toBeTruthy(); // مباشرة بحسابي (Apple)
  });

  it('configured links open WhatsApp, the dialer and the https pages', async () => {
    Object.assign(mockConfig, {
      shopWhatsapp: '9647701112222',
      shopPhone: '07701112222',
      privacyUrl: 'https://admin.mukhdar.test/privacy',
      termsUrl: 'https://admin.mukhdar.test/terms',
    });
    setup();
    await renderUi(<AccountScreen />);
    await fireEvent.press(await screen.findByTestId('account-whatsapp'));
    await fireEvent.press(screen.getByTestId('account-call'));
    await fireEvent.press(screen.getByTestId('account-privacy'));
    await fireEvent.press(screen.getByTestId('account-terms'));
    expect(openSpy.mock.calls.map((c) => c[0])).toEqual([
      'https://wa.me/9647701112222',
      'tel:+9647701112222',
      'https://admin.mukhdar.test/privacy',
      'https://admin.mukhdar.test/terms',
    ]);
  });

  it('while the name loads: no "بدون اسم" flash (review NH2)', async () => {
    let release: () => void = () => undefined;
    setup({ fullName: null, profileGate: new Promise<void>((r) => (release = r)) });
    await renderUi(<AccountScreen />);
    expect(screen.getByTestId('account-name')).toHaveTextContent('…');
    expect(screen.queryByText(ar.account.noName)).toBeNull();
    await act(async () => release());
    expect(await screen.findByText(ar.account.noName)).toBeTruthy();
  });

  it('sign-out: deletes this device push token first, then local signOut, clears the query cache, keeps the cart (review NH1, NH11)', async () => {
    const { auth, calls } = setup();
    useCart.setState({ items: { t: 2 }, flags: {} });
    await AsyncStorage.setItem('mukhdar.pushToken', 'ExponentPushToken[x]');
    await renderUi(<AccountScreen />);
    await screen.findByText('أحمد');
    renderedClient.setQueryData(['orders', 'u1'], { pages: [[{ id: 'o1' }]], pageParams: [null] });
    let tokenDeletedBeforeSignOut = false;
    auth.signOut.mockImplementationOnce(() => {
      tokenDeletedBeforeSignOut = calls.some(
        (c) => c.table === 'push_tokens' && c.ops.some(([n]) => n === 'delete'),
      );
      useAuth.setState({ session: null, ready: true });
      return Promise.resolve({ error: null });
    });
    await fireEvent.press(screen.getByTestId('sign-out'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(tokenDeletedBeforeSignOut).toBe(true);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(renderedClient.getQueryData(['orders', 'u1'])).toBeUndefined();
    expect(useCart.getState().items).toEqual({ t: 2 });
  });

  it('navigation rows: edit name, change PIN, orders', async () => {
    setup({ fullName: null });
    await renderUi(<AccountScreen />);
    expect(await screen.findByText(ar.account.noName)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('edit-name'));
    await fireEvent.press(screen.getByTestId('account-pin'));
    await fireEvent.press(screen.getByTestId('account-orders'));
    expect(mockRouter.push).toHaveBeenCalledWith('/account/name');
    expect(mockRouter.push).toHaveBeenCalledWith('/account/pin');
    expect(mockRouter.navigate).toHaveBeenCalledWith('/orders');
  });
});

// ------------------------------------------------------------------ حذف الحساب
describe('delete account', () => {
  it('needs two confirmations before calling delete-account', async () => {
    const { functions } = setup();
    await renderUi(<AccountScreen />);
    await fireEvent.press(await screen.findByTestId('delete-account'));
    expect(alertSpy).toHaveBeenLastCalledWith(
      ar.account.deleteTitle,
      ar.account.deleteBody,
      expect.any(Array),
    );
    pressAlertButton(ar.account.deleteContinue);
    expect(alertSpy).toHaveBeenLastCalledWith(
      ar.account.deleteFinalTitle,
      ar.account.deleteFinalBody,
      expect.any(Array),
    );
    expect(functions.invoke).not.toHaveBeenCalled();
    pressAlertButton(ar.account.deleteCancel); // تراجع بالخطوة الثانية
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it('ACTIVE_ORDER shows its Arabic message and keeps the session and data', async () => {
    const { functions, auth } = setup({
      invoke: () => ({ data: null, error: functionError('ACTIVE_ORDER') }),
    });
    useCart.setState({ items: { t: 2 }, flags: {} });
    await renderUi(<AccountScreen />);
    await fireEvent.press(await screen.findByTestId('delete-account'));
    pressAlertButton(ar.account.deleteContinue);
    await act(async () => pressAlertButton(ar.account.deleteFinalConfirm));
    expect(await screen.findByText(ERROR_MESSAGES.ACTIVE_ORDER)).toBeTruthy();
    expect(functions.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(useCart.getState().items).toEqual({ t: 2 });
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('success clears local data, signs out and goes home', async () => {
    const { auth } = setup();
    useCart.setState({ items: { t: 2 }, flags: {} });
    useOrderAttempt.setState({ key: 'k1', signature: 't:2', createdAt: Date.now() });
    useSelectedAddress.setState({ selectedId: 'a1' });
    await AsyncStorage.multiSet([
      ['mukhdar.pushToken', 'ExponentPushToken[x]'],
      ['mukhdar.pushAsked', '1'],
      ['mukhdar.queryCache', '{}'],
    ]);
    await renderUi(<AccountScreen />);
    renderedClient.setQueryData(['orders', 'u1'], { pages: [[{ id: 'o1' }]], pageParams: [null] });
    await fireEvent.press(await screen.findByTestId('delete-account'));
    pressAlertButton(ar.account.deleteContinue);
    await act(async () => pressAlertButton(ar.account.deleteFinalConfirm));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    // NH11: كاش الاستعلامات فُرّغ (لا طلبات الحساب المحذوف بالذاكرة)
    expect(renderedClient.getQueryData(['orders', 'u1'])).toBeUndefined();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useAuth.getState().session).toBeNull();
    expect(useCart.getState().items).toEqual({});
    expect(useOrderAttempt.getState().key).toBeNull();
    expect(useSelectedAddress.getState().selectedId).toBeNull();
    const stored = await AsyncStorage.multiGet([...LOCAL_DATA_KEYS]);
    expect(stored.every(([, v]) => v === null)).toBe(true);
    expect(alertSpy).toHaveBeenLastCalledWith(ar.account.deleted);
  });

  it('a network failure shows the network message', async () => {
    setup({ invoke: () => ({ data: null, error: { name: 'FunctionsFetchError', message: 'x' } }) });
    await renderUi(<AccountScreen />);
    await fireEvent.press(await screen.findByTestId('delete-account'));
    pressAlertButton(ar.account.deleteContinue);
    await act(async () => pressAlertButton(ar.account.deleteFinalConfirm));
    expect(await screen.findByText(/الاتصال|الإنترنت|الشبكة/)).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ تغيير الرمز
describe('change PIN', () => {
  async function fill(current: string, next: string, confirm = next) {
    await fireEvent.changeText(screen.getByTestId('pin-current'), current);
    await fireEvent.changeText(screen.getByTestId('pin-new'), next);
    await fireEvent.changeText(screen.getByTestId('pin-confirm'), confirm);
    await fireEvent.press(screen.getByTestId('pin-submit'));
  }

  it('wrong current PIN shows a message and does not update', async () => {
    const { auth } = setup({
      signIn: () => ({
        data: { session: null, user: null },
        error: { name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'x' },
      }),
    });
    await renderUi(<ChangePinScreen />);
    await fill('111111', '482915');
    expect(await screen.findByText(ar.account.pinWrongCurrent)).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647701234567',
      password: '111111',
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('an easy new PIN is rejected before any request', async () => {
    const { auth } = setup();
    await renderUi(<ChangePinScreen />);
    await fill('482915', '123456');
    expect(await screen.findByText(PIN_MESSAGES.PIN_TRIVIAL)).toBeTruthy();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('mismatched confirmation is rejected', async () => {
    const { auth } = setup();
    await renderUi(<ChangePinScreen />);
    await fill('482915', '739164', '739165');
    expect(await screen.findByText(ar.auth.pinMismatch)).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('success verifies the current PIN, then updateUser with Latin digits', async () => {
    const { auth } = setup();
    await renderUi(<ChangePinScreen />);
    await fill('٤٨٢٩١٥', '٧٣٩١٦٤'); // أرقام عربية-هندية
    expect(await screen.findByText(ar.account.pinChanged)).toBeTruthy();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647701234567',
      password: '482915',
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: '739164' });
    // review S1: الجلسات الأخرى تُبطل بعد التغيير، وجلسة هذا الجهاز تبقى
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().session).not.toBeNull();
    expect(screen.getByTestId('pin-current').props.value).toBe('');
  });

  it('forced (temporary PIN): no back button; after the change the sign-in flow continues', async () => {
    mockSearchParams = { forced: '1', redirect: '/orders' };
    const { auth } = setup();
    await renderUi(<ChangePinScreen />);
    expect(screen.getByTestId('pin-forced')).toHaveTextContent(ar.account.pinForcedHint);
    expect(screen.queryByText(ar.account.back)).toBeNull();
    await fill('482915', '739164');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/orders'));
    expect(auth.updateUser).toHaveBeenCalledWith({ password: '739164' });
    mockSearchParams = {};
  });

  it('same PIN as the current one is rejected', async () => {
    const { auth } = setup();
    await renderUi(<ChangePinScreen />);
    await fill('482915', '482915');
    expect(await screen.findByText(ar.account.pinSame)).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ تعديل الاسم
describe('edit name', () => {
  it('prefills the current name and saves the cleaned new one', async () => {
    const { calls } = setup();
    await renderUi(<EditNameScreen />);
    await waitFor(() => expect(screen.getByTestId('name-input').props.value).toBe('أحمد'));
    expect(screen.getByTestId('name-submit').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('name-input'), '  أحمد   علي ');
    await fireEvent.press(screen.getByTestId('name-submit'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    const update = calls.find((c) => c.table === 'profiles' && opArgs(c, 'update')) as Call;
    expect(opArgs(update, 'update')).toEqual([{ full_name: 'أحمد علي' }]);
    expect(opArgs(update, 'eq')).toEqual(['id', 'u1']);
  });

  it('a one-letter name cannot be saved', async () => {
    setup({ fullName: null });
    await renderUi(<EditNameScreen />);
    await fireEvent.changeText(screen.getByTestId('name-input'), 'أ');
    expect(screen.getByTestId('name-submit').props.accessibilityState.disabled).toBe(true);
  });
});
