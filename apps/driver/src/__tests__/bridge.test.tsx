// NotificationsBridge (SPEC-driver §2.11): التسجيل بعد تغيير الرمز المؤقت فقط، التوجيه حسب data.type (حتى من الإغلاق)
// بعد جاهزية الحارس، وشريط "الإشعارات مطفية" بالجاهزة.
import { act, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import ReadyScreen from '../app/(tabs)/index';
import { useAuth } from '../features/auth/store';
import { NotificationsBridge } from '../features/notifications/NotificationsBridge';
import { emitNotification } from '../features/notifications/events';
import { ar } from '../i18n/ar';
import { createFakeSupabase } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a) },
    useFocusEffect: (cb: () => (() => void) | undefined) => useEffect(cb, [cb]),
  };
});
jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'p' } } }, executionEnvironment: 'bare' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

const UUID = '11111111-2222-4333-8444-555555555555';
const driver = {
  role: 'driver',
  is_active: true,
  must_change_pin: false,
  full_name: 'ع',
  phone: '9647801112222',
};
const SESSION = { user: { id: 'me' } } as never;

function response(data: object) {
  return {
    actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: { request: { content: { data } } },
  } as never;
}

beforeEach(() => {
  mockPush.mockClear();
  jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(null);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
  jest
    .mocked(Notifications.getExpoPushTokenAsync)
    .mockResolvedValue({ data: 'ExponentPushToken[abc]' } as never);
  useAuth.setState({
    ready: true,
    session: SESSION,
    profile: driver,
    profileError: false,
    hasRegistration: false,
    sessionOffline: false,
  });
});

describe('push registration', () => {
  it('registers for an active driver after sign-in', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    mockClient = fake.client;
    await renderScreen(<NotificationsBridge />);
    await waitFor(() =>
      expect(fake.calls.some((c) => c.table === 'rpc:register_push_token')).toBe(true),
    );
  });

  it('does NOT register while must_change_pin; registers once the PIN is changed', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    mockClient = fake.client;
    useAuth.setState({ profile: { ...driver, must_change_pin: true } });
    await renderScreen(<NotificationsBridge />);
    await act(async () => undefined);
    expect(fake.calls.some((c) => c.table === 'rpc:register_push_token')).toBe(false);
    await act(async () => useAuth.setState({ profile: driver }));
    await waitFor(() =>
      expect(fake.calls.some((c) => c.table === 'rpc:register_push_token')).toBe(true),
    );
  });

  it('does not register for a non-driver account', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    mockClient = fake.client;
    useAuth.setState({ profile: { ...driver, role: 'customer' } });
    await renderScreen(<NotificationsBridge />);
    await act(async () => undefined);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('notification tap routing (also cold start)', () => {
  it('"ready" opens that order', async () => {
    mockClient = createFakeSupabase(() => ({ data: null, error: null })).client;
    jest
      .mocked(Notifications.useLastNotificationResponse)
      .mockReturnValue(response({ type: 'ready', order_id: UUID }));
    await renderScreen(<NotificationsBridge />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/order/${UUID}`));
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('waits for the guard to know the destination before navigating (cold start)', async () => {
    mockClient = createFakeSupabase(() => ({ data: null, error: null })).client;
    useAuth.setState({ ready: false, session: null, profile: null });
    jest
      .mocked(Notifications.useLastNotificationResponse)
      .mockReturnValue(response({ type: 'cancelled', order_id: UUID }));
    await renderScreen(<NotificationsBridge />);
    await act(async () => undefined);
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => useAuth.setState({ ready: true, session: SESSION, profile: driver }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/my-orders'));
  });

  it('approval notification on a device with a saved request opens Pending', async () => {
    mockClient = createFakeSupabase(() => ({ data: null, error: null })).client;
    useAuth.setState({ ready: true, session: null, profile: null, hasRegistration: true });
    jest
      .mocked(Notifications.useLastNotificationResponse)
      .mockReturnValue(response({ type: 'driver_request_approved' }));
    await renderScreen(<NotificationsBridge />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/auth/pending'));
  });

  it('unknown type does nothing', async () => {
    mockClient = createFakeSupabase(() => ({ data: null, error: null })).client;
    jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(response({ type: 'x' }));
    await renderScreen(<NotificationsBridge />);
    await act(async () => undefined);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('Ready screen: notifications off banner and live refresh', () => {
  it('shows the banner when permission is denied', async () => {
    mockClient = createFakeSupabase(() => ({ data: [], error: null })).client;
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'denied' } as never);
    await renderScreen(<ReadyScreen />);
    expect(await screen.findByTestId('push-off-banner')).toBeTruthy();
    expect(screen.getByText(ar.push.offBanner)).toBeTruthy();
  });

  it('no banner when granted', async () => {
    mockClient = createFakeSupabase(() => ({ data: [], error: null })).client;
    await renderScreen(<ReadyScreen />);
    await screen.findByText(ar.orders.readyEmpty);
    expect(screen.queryByTestId('push-off-banner')).toBeNull();
  });

  it('a new_order notification while open refreshes the list', async () => {
    const fake = createFakeSupabase(() => ({ data: [], error: null }));
    mockClient = fake.client;
    await renderScreen(<ReadyScreen />);
    await screen.findByText(ar.orders.readyEmpty);
    const before = fake.calls.filter((c) => c.table === 'rpc:available_orders').length;
    await act(async () => emitNotification({ type: 'new_order', order_id: UUID }));
    await waitFor(() =>
      expect(fake.calls.filter((c) => c.table === 'rpc:available_orders').length).toBeGreaterThan(
        before,
      ),
    );
  });
});
