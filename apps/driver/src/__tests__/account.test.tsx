// حسابي (SPEC-driver §2.10): الصفحة، تغيير الرمز، الخروج (حذف رمز الجهاز قبل signOut)، حذف الحساب.
import { PIN_CHANGE_MESSAGES } from '@mukhdar/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';
import AccountScreen from '../app/(tabs)/account';
import ChangePinScreen from '../app/account/change-pin';
import { deleteDriverAccount } from '../features/account/account';
import { signOut, useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { registerPushToken } from '../lib/push';
import {
  createFakeSupabase,
  functionError,
  type Call,
  type Result,
} from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('../config', () => ({
  config: {
    supabaseUrl: 'https://x.supabase.co',
    supabaseKey: 'k',
    shopPhone: '07801112222',
    shopWhatsapp: '9647801112222',
  },
  isSupabaseConfigured: () => true,
}));
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    back: (...a: unknown[]) => mockBack(...a),
    replace: jest.fn(),
    canGoBack: () => true,
  },
}));
jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'p' } } }, executionEnvironment: 'bare' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

const PROFILE = {
  role: 'driver',
  is_active: true,
  must_change_pin: false,
  full_name: 'أبو علي',
  phone: '9647805551212',
};
const SESSION = { user: { id: 'me', phone: '9647805551212' } } as never;

function makeAuth(over: Record<string, unknown> = {}) {
  return {
    signOut: jest.fn(() => Promise.resolve({ error: null })),
    signInWithPassword: jest.fn(() => Promise.resolve({ error: null })),
    updateUser: jest.fn(() => Promise.resolve({ error: null })),
    ...over,
  };
}
const ok: Result = { data: null, error: null };

beforeEach(() => {
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  useAuth.setState({
    ready: true,
    session: SESSION,
    profile: PROFILE,
    profileError: false,
    hasRegistration: false,
    sessionOffline: false,
  });
});
afterEach(() => jest.restoreAllMocks());

describe('AccountScreen', () => {
  it('name, formatted phone and the role', async () => {
    mockClient = createFakeSupabase(() => ok, makeAuth()).client;
    await renderScreen(<AccountScreen />);
    expect(screen.getByText('أبو علي')).toBeTruthy();
    expect(screen.getByText('07805551212')).toBeTruthy();
    expect(screen.getByText(ar.account.role)).toBeTruthy();
  });

  it('call and WhatsApp the shop', async () => {
    mockClient = createFakeSupabase(() => ok, makeAuth()).client;
    await renderScreen(<AccountScreen />);
    await fireEvent.press(screen.getByTestId('account-call'));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+9647801112222');
    await fireEvent.press(screen.getByTestId('account-whatsapp'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://wa.me/9647801112222');
  });

  it('delete account asks for confirmation first; ACTIVE_ORDER shows its message', async () => {
    const fake = createFakeSupabase(
      (call: Call) =>
        call.table === 'fn:delete-account'
          ? { data: null, error: functionError(409, { error: 'ACTIVE_ORDER' }) }
          : ok,
      makeAuth(),
    );
    mockClient = fake.client;
    await renderScreen(<AccountScreen />);
    await fireEvent.press(screen.getByTestId('account-delete'));
    expect(fake.calls.some((c) => c.table === 'fn:delete-account')).toBe(false);
    await fireEvent.press(await screen.findByTestId('delete-confirm'));
    expect(await screen.findByText(ar.account.deleteActiveOrder)).toBeTruthy();
  });
});

describe('signOut: token row first, then channels, then this device only', () => {
  async function remember(client: never) {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValue({ status: 'granted' } as never);
    jest
      .mocked(Notifications.getExpoPushTokenAsync)
      .mockResolvedValue({ data: 'ExponentPushToken[dev1]' } as never);
    await registerPushToken(client, { ask: false });
  }

  it('deletes the push_tokens row BEFORE signOut (local scope), and removes Realtime channels', async () => {
    const order: string[] = [];
    const auth = makeAuth({
      signOut: jest.fn(() => (order.push('signOut'), Promise.resolve({ error: null }))),
    });
    const fake = createFakeSupabase((call) => {
      if (call.table === 'push_tokens') order.push('delete-token');
      return ok;
    }, auth);
    const client = Object.assign(fake.client, {
      removeAllChannels: jest.fn(() => (order.push('channels'), Promise.resolve([]))),
    });
    await remember(client as never);
    order.length = 0;
    await signOut(client as never);
    expect(order).toEqual(['delete-token', 'channels', 'signOut']);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('the Sign out button on the account tab uses it', async () => {
    const auth = makeAuth();
    const fake = createFakeSupabase(() => ok, auth);
    mockClient = Object.assign(fake.client, { removeAllChannels: jest.fn() });
    await renderScreen(<AccountScreen />);
    await fireEvent.press(screen.getByTestId('account-sign-out'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
  });

  it('no remembered token: just signs out', async () => {
    const auth = makeAuth();
    const fake = createFakeSupabase(() => ok, auth);
    const client = Object.assign(fake.client, { removeAllChannels: jest.fn() });
    await signOut(client as never);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(Notifications.unregisterForNotificationsAsync).not.toHaveBeenCalled();
  });
});

describe('deleteDriverAccount', () => {
  it('ACTIVE_ORDER -> refused with the Arabic message, session untouched', async () => {
    const auth = makeAuth();
    const fake = createFakeSupabase(
      () => ({ data: null, error: functionError(409, { error: 'ACTIVE_ORDER' }) }),
      auth,
    );
    const r = await deleteDriverAccount(fake.client as never);
    expect(r).toEqual({ ok: false, message: ar.account.deleteActiveOrder });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('success -> local sign-out', async () => {
    const auth = makeAuth();
    const fake = createFakeSupabase(() => ({ data: { deleted: true }, error: null }), auth);
    expect(await deleteDriverAccount(fake.client as never)).toEqual({ ok: true });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('ChangePinScreen (account)', () => {
  async function fill(current: string, next: string, confirm: string) {
    await fireEvent.changeText(screen.getByTestId('pin-current'), current);
    await fireEvent.changeText(screen.getByTestId('pin-new'), next);
    await fireEvent.changeText(screen.getByTestId('pin-confirm'), confirm);
    await fireEvent.press(screen.getByTestId('pin-submit'));
  }

  it('mismatch', async () => {
    mockClient = createFakeSupabase(() => ok, makeAuth()).client;
    await renderScreen(<ChangePinScreen />);
    await fill('482915', '730514', '730515');
    expect(await screen.findByText(PIN_CHANGE_MESSAGES.mismatch)).toBeTruthy();
  });

  it('new equals current', async () => {
    mockClient = createFakeSupabase(() => ok, makeAuth()).client;
    await renderScreen(<ChangePinScreen />);
    await fill('482915', '482915', '482915');
    expect(await screen.findByText(PIN_CHANGE_MESSAGES.same)).toBeTruthy();
  });

  it('wrong current PIN fails and nothing changes', async () => {
    const auth = makeAuth({
      signInWithPassword: jest.fn(() =>
        Promise.resolve({
          error: {
            status: 400,
            code: 'invalid_credentials',
            name: 'AuthApiError',
            message: 'Invalid login credentials',
          },
        }),
      ),
    });
    mockClient = createFakeSupabase(() => ok, auth).client;
    await renderScreen(<ChangePinScreen />);
    await fill('111222', '730514', '730514');
    expect(await screen.findByText(PIN_CHANGE_MESSAGES.wrongCurrent)).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('success: updates the password, signs out the other devices, goes back', async () => {
    const auth = makeAuth();
    mockClient = createFakeSupabase(() => ok, auth).client;
    await renderScreen(<ChangePinScreen />);
    await fill('482915', '730514', '730514');
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: '730514' }));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });
});
