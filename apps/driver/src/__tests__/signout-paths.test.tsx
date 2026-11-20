// R2 M2: كل مسارات الخروج (حسابي، ماكو اتصال، غير سائق، الرمز الإجباري) تحذف رمز إشعارات هذا الجهاز من الخادم أولاً؛
// بلا شبكة: يُبطَل رمز الجهاز ويؤجَّل الحذف ويُعاد بأول جلسة. والخروج `local` (هذا الجهاز فقط، SPEC-driver §2.10).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import AccountScreen from '../app/(tabs)/account';
import ChangePinScreen from '../app/auth/change-pin';
import NotDriverScreen from '../app/auth/not-driver';
import OfflineScreen from '../app/auth/offline';
import { signOut, useAuth } from '../features/auth/store';
import {
  PENDING_UNREGISTER_KEY,
  PUSH_TOKEN_KEY,
  registerPushToken,
  retryPendingPushUnregister,
} from '../lib/push';
import { createFakeSupabase, type Call, type Result } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('../config', () => ({
  config: {
    supabaseUrl: 'https://x.supabase.co',
    supabaseKey: 'k',
    shopPhone: '0780',
    shopWhatsapp: '',
  },
  isSupabaseConfigured: () => true,
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));
jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: 'proj-1' } } },
    executionEnvironment: 'bare',
  },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

const SESSION = { user: { id: 'u1', phone: '9647805551212' } } as never;
const DRIVER = {
  role: 'driver',
  is_active: true,
  must_change_pin: false,
  full_name: 'علي',
  phone: '9647805551212',
};
const TOKEN = 'ExponentPushToken[dev1]';

/** عميل مزيف: ما يحذف push_tokens يفشل بالشبكة إن offline */
function setup(opts: { offline?: boolean } = {}) {
  const order: string[] = [];
  const auth = {
    signOut: jest.fn(() => (order.push('signOut'), Promise.resolve({ error: null }))),
  };
  const fake = createFakeSupabase((call: Call): Result => {
    if (call.table === 'push_tokens') {
      order.push('delete-token');
      return opts.offline
        ? { data: null, error: { message: 'Network request failed' } }
        : { data: null, error: null };
    }
    return { data: DRIVER, error: null };
  }, auth);
  const client = Object.assign(fake.client, {
    removeAllChannels: jest.fn(() => (order.push('channels'), Promise.resolve([]))),
  });
  mockClient = client;
  return { client, auth, order };
}

async function rememberToken() {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
  jest.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ data: TOKEN } as never);
  await registerPushToken(createFakeSupabase(() => ({ data: null, error: null })).client as never, {
    ask: false,
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(Notifications.unregisterForNotificationsAsync).mockClear();
  useAuth.setState({
    ready: true,
    session: SESSION,
    profile: DRIVER,
    profileError: false,
    hasRegistration: false,
    sessionOffline: false,
  });
  await rememberToken();
});

const screens: [string, () => React.ReactElement, string, object][] = [
  ['account tab', () => <AccountScreen />, 'account-sign-out', {}],
  ['offline screen', () => <OfflineScreen />, 'offline-sign-out', {}],
  ['not-driver screen', () => <NotDriverScreen />, 'not-driver-sign-out', { role: 'customer' }],
  ['forced PIN screen', () => <ChangePinScreen />, 'pin-sign-out', { must_change_pin: true }],
];

describe.each(screens)('%s sign-out', (_name, element, testID, profile) => {
  beforeEach(() => useAuth.setState({ profile: { ...DRIVER, ...profile } as never }));

  it('online: deletes the token row first, then channels, then a LOCAL sign-out', async () => {
    const t = setup();
    await renderScreen(element());
    t.order.length = 0;
    await fireEvent.press(screen.getByTestId(testID));
    await waitFor(() => expect(useAuth.getState().session).toBeNull());
    expect(t.order).toEqual(['delete-token', 'channels', 'signOut']);
    expect(t.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(PENDING_UNREGISTER_KEY)).toBeNull();
    expect(Notifications.unregisterForNotificationsAsync).not.toHaveBeenCalled();
  });

  it('offline: still signs out, invalidates the device token and queues the server delete', async () => {
    const t = setup({ offline: true });
    await renderScreen(element());
    await fireEvent.press(screen.getByTestId(testID));
    await waitFor(() => expect(useAuth.getState().session).toBeNull());
    expect(t.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(PENDING_UNREGISTER_KEY)).toBe(TOKEN);
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });
});

describe('queued delete', () => {
  it('is retried with the next session and cleared on success', async () => {
    const off = setup({ offline: true });
    await signOut(off.client as never);
    expect(await AsyncStorage.getItem(PENDING_UNREGISTER_KEY)).toBe(TOKEN);

    const stillOff = setup({ offline: true });
    await retryPendingPushUnregister(stillOff.client as never);
    expect(await AsyncStorage.getItem(PENDING_UNREGISTER_KEY)).toBe(TOKEN);

    const on = createFakeSupabase(() => ({ data: null, error: null }));
    await retryPendingPushUnregister(on.client as never);
    expect(on.calls[0]?.table).toBe('push_tokens');
    expect(on.calls[0]?.ops).toEqual(expect.arrayContaining([['eq', ['token', TOKEN]]]));
    expect(await AsyncStorage.getItem(PENDING_UNREGISTER_KEY)).toBeNull();
  });

  it('registering the same token again cancels the stale queued delete', async () => {
    const off = setup({ offline: true });
    await signOut(off.client as never);
    await rememberToken();
    expect(await AsyncStorage.getItem(PENDING_UNREGISTER_KEY)).toBeNull();
    const on = createFakeSupabase(() => ({ data: null, error: null }));
    await retryPendingPushUnregister(on.client as never);
    expect(on.calls).toHaveLength(0);
  });
});
