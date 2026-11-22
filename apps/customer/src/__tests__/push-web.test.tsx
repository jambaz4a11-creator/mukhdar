// T38: Web Push بالزبون: بطاقة التمهيد بعد أول طلب (لكل حالة)، "مو هسه"، التسجيل الصامت، الخروج، وجسر رسائل الـ SW.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { WebPushState } from '@mukhdar/shared';
import type { ReactElement } from 'react';
import { ar } from '../i18n/ar';

const mockController = {
  getState: jest.fn<Promise<WebPushState>, [boolean]>(),
  register: jest.fn(),
  remove: jest.fn(),
  retryPending: jest.fn(),
  unsubscribeLocal: jest.fn(),
  isSnoozed: jest.fn(),
  snooze: jest.fn(),
};
jest.mock('../features/notifications/webPushController', () => ({
  getWebPush: () => mockController,
  hasVapidKey: () => true,
  needsInstall: () => false,
  PENDING_DELETE_KEY: 'pending',
  PUSH_SNOOZE_KEY: 'snooze',
}));
// على الويب push = push.web (يُحلّه الـ bundler)؛ نحاكي ذلك هنا
jest.mock('../features/notifications/push', () =>
  jest.requireActual('../features/notifications/push.web'),
);
let mockClient: unknown = { id: 'client' };
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: (...a: unknown[]) => mockRouterPush(...a), back: jest.fn() },
}));

import { PushPrompt } from '../features/notifications/PushPrompt.web';
import { NotificationsBridge } from '../features/notifications/NotificationsBridge.web';
import * as push from '../features/notifications/push.web';
import { useAuth } from '../features/auth/store';

function renderUi(ui: ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

type AuthListener = (event: string) => void;
let mockAuthListeners: AuthListener[] = [];
const fakeOnAuthStateChange = (fn: AuthListener) => {
  mockAuthListeners.push(fn);
  return { data: { subscription: { unsubscribe: jest.fn() } } };
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      visibilityState: 'visible',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  });
  mockController.isSnoozed.mockResolvedValue(false);
  mockController.snooze.mockResolvedValue(undefined);
  mockController.remove.mockResolvedValue(undefined);
  mockController.retryPending.mockResolvedValue(undefined);
  mockAuthListeners = [];
  mockClient = { id: 'client', auth: { onAuthStateChange: fakeOnAuthStateChange } };
});

describe('PushPrompt (after the first order)', () => {
  it('default: shows the card and does NOT ask for permission by itself', async () => {
    mockController.getState.mockResolvedValue('default');
    await renderUi(<PushPrompt />);
    expect(await screen.findByText(ar.notifications.promptBody)).toBeTruthy();
    expect(mockController.register).not.toHaveBeenCalled();
  });

  it('tapping enable asks (ask: true) and the card goes away once registered', async () => {
    mockController.getState.mockResolvedValueOnce('default').mockResolvedValue('registered');
    mockController.register.mockResolvedValue('registered');
    await renderUi(<PushPrompt />);
    await fireEvent.press(await screen.findByTestId('push-enable'));
    await waitFor(() => expect(screen.queryByTestId('push-prompt')).toBeNull());
    expect(mockController.register).toHaveBeenCalledWith(mockClient, { ask: true });
  });

  it('a failed registration keeps the card with a retry message', async () => {
    mockController.getState.mockResolvedValue('default');
    mockController.register.mockResolvedValue('failed');
    await renderUi(<PushPrompt />);
    await fireEvent.press(await screen.findByTestId('push-enable'));
    expect(await screen.findByTestId('push-enable-failed')).toBeTruthy();
  });

  it('"not now" hides the card and snoozes it', async () => {
    mockController.getState.mockResolvedValue('default');
    await renderUi(<PushPrompt />);
    await fireEvent.press(await screen.findByTestId('push-later'));
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    expect(mockController.snooze).toHaveBeenCalledTimes(1);
  });

  it('snoozed: stays hidden', async () => {
    mockController.getState.mockResolvedValue('default');
    mockController.isSnoozed.mockResolvedValue(true);
    await renderUi(<PushPrompt />);
    await waitFor(() => expect(mockController.getState).toHaveBeenCalled());
    expect(screen.queryByTestId('push-prompt')).toBeNull();
  });

  it('denied: banner with how-to, no enable button', async () => {
    mockController.getState.mockResolvedValue('denied');
    await renderUi(<PushPrompt />);
    expect(await screen.findByTestId('push-denied-banner')).toBeTruthy();
    expect(screen.getByText(ar.notifications.deniedHow)).toBeTruthy();
    expect(screen.queryByTestId('push-enable')).toBeNull();
  });

  it('needs-install (iOS outside the PWA): the install guide instead of the permission button', async () => {
    mockController.getState.mockResolvedValue('needs-install');
    await renderUi(<PushPrompt />);
    expect(await screen.findByText(ar.notifications.needsInstall)).toBeTruthy();
    expect(screen.queryByTestId('push-enable')).toBeNull();
  });

  it.each<WebPushState>(['unsupported', 'granted-unregistered', 'registered'])(
    '%s: renders nothing',
    async (s) => {
      mockController.getState.mockResolvedValue(s);
      await renderUi(<PushPrompt />);
      await waitFor(() => expect(mockController.getState).toHaveBeenCalled());
      expect(screen.queryByTestId('push-prompt')).toBeNull();
      expect(screen.queryByTestId('push-denied-banner')).toBeNull();
      expect(screen.queryByTestId('push-install-card')).toBeNull();
    },
  );
});

describe('push.web wiring', () => {
  it('unregisterPushToken (sign-out) removes the subscription through the controller', async () => {
    await push.unregisterPushToken(mockClient as never);
    expect(mockController.remove).toHaveBeenCalledWith(mockClient);
  });

  it('askAfterFirstOrder registers silently only when permission is already granted', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serviceWorker: {} },
    });
    mockController.register.mockResolvedValue('registered');
    mockController.getState.mockResolvedValue('default');
    await push.askAfterFirstOrder(mockClient as never);
    expect(mockController.register).not.toHaveBeenCalled(); // الإذن يُسأل ببطاقة الصفحة فقط
    mockController.getState.mockResolvedValue('granted-unregistered');
    await push.askAfterFirstOrder(mockClient as never);
    expect(mockController.register).toHaveBeenCalledWith(mockClient, { ask: false });
  });
});

describe('NotificationsBridge.web', () => {
  type Listener = (e: { data?: unknown }) => void;
  let listeners: Listener[];
  beforeEach(() => {
    listeners = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          addEventListener: (_t: string, fn: Listener) => listeners.push(fn),
          removeEventListener: (_t: string, fn: Listener) => {
            listeners = listeners.filter((l) => l !== fn);
          },
        },
      },
    });
    useAuth.setState({
      session: { user: { id: 'u1' } } as never,
      ready: true,
      mustChangePin: false,
    });
  });

  it('registers silently (ask: false) and retries a deferred delete on a signed-in session', async () => {
    mockController.register.mockResolvedValue('registered');
    await renderUi(<NotificationsBridge />);
    await waitFor(() => expect(mockController.register).toHaveBeenCalled());
    expect(mockController.register).toHaveBeenCalledWith(mockClient, { ask: false, userId: 'u1' });
    expect(mockController.retryPending).toHaveBeenCalledWith(mockClient);
  });

  it('R3 L1: a passive SIGNED_OUT (revoked session, deleted account) unsubscribes locally', async () => {
    jest.useFakeTimers();
    try {
      await renderUi(<NotificationsBridge />);
      for (const l of mockAuthListeners) l('SIGNED_IN');
      jest.runOnlyPendingTimers();
      expect(mockController.unsubscribeLocal).not.toHaveBeenCalled();
      for (const l of mockAuthListeners) l('SIGNED_OUT');
      jest.runOnlyPendingTimers();
      expect(mockController.unsubscribeLocal).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does nothing while a temporary PIN must be changed or without a session', async () => {
    useAuth.setState({ mustChangePin: true });
    await renderUi(<NotificationsBridge />);
    useAuth.setState({ session: null, mustChangePin: false });
    expect(mockController.register).not.toHaveBeenCalled();
  });

  it('a click message opens the order (and the rating screen for delivered), forged ids are ignored', async () => {
    mockController.register.mockResolvedValue('registered');
    await renderUi(<NotificationsBridge />);
    const id = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
    await act(async () => {
      for (const l of listeners) {
        l({
          data: { type: 'mukhdar:notification-click', data: { status: 'ready', order_id: '../x' } },
        });
      }
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
    await act(async () => {
      for (const l of listeners) {
        l({
          data: { type: 'mukhdar:notification-click', data: { status: 'ready', order_id: id } },
        });
      }
    });
    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: '/order/[id]', params: { id } });
  });
});
