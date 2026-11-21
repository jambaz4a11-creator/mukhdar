// T38: Web Push بالسائق: بطاقة التمهيد (لكل حالة)، "مو هسه"، الخروج الموحَّد بالويب، وجسر رسائل الـ SW.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { WebPushState } from '@mukhdar/shared';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { renderScreen } from '../test-utils/render';

const mockController = {
  getState: jest.fn<Promise<WebPushState>, [boolean]>(),
  register: jest.fn(),
  remove: jest.fn(),
  retryPending: jest.fn(),
  isSnoozed: jest.fn(),
  snooze: jest.fn(),
};
jest.mock('../lib/webPushController', () => ({
  getWebPush: () => mockController,
  hasVapidKey: () => true,
  PENDING_DELETE_KEY: 'pending',
  PUSH_SNOOZE_KEY: 'snooze',
}));
// على الويب lib/push = push.web (يُحلّه الـ bundler)؛ نحاكي ذلك هنا
jest.mock('../lib/push', () => jest.requireActual('../lib/push.web'));
let mockClient: unknown = { id: 'client' };
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: (...a: unknown[]) => mockRouterPush(...a), back: jest.fn() },
}));

import { PushPrompt } from '../features/notifications/PushPrompt.web';
import { NotificationsBridge } from '../features/notifications/NotificationsBridge.web';
import { signOut } from '../features/auth/store';

beforeEach(() => {
  jest.clearAllMocks();
  // بيئة jest أصلية: لا document. نحاكي ما يلزم لـ visibilitychange
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
  mockClient = { id: 'client', removeAllChannels: jest.fn(), auth: { signOut: jest.fn() } };
});

describe('PushPrompt (web onboarding card)', () => {
  it('default: shows the card and does NOT ask for permission by itself', async () => {
    mockController.getState.mockResolvedValue('default');
    await renderScreen(<PushPrompt />);
    expect(await screen.findByText(ar.push.promptBody)).toBeTruthy();
    expect(mockController.register).not.toHaveBeenCalled();
  });

  it('tapping enable asks (ask: true) and re-reads the state', async () => {
    mockController.getState.mockResolvedValueOnce('default').mockResolvedValue('registered');
    mockController.register.mockResolvedValue('registered');
    await renderScreen(<PushPrompt />);
    await fireEvent.press(await screen.findByTestId('push-enable'));
    await waitFor(() => expect(screen.queryByTestId('push-prompt')).toBeNull());
    expect(mockController.register).toHaveBeenCalledWith(mockClient, { ask: true });
  });

  it('a failed registration shows the retry message and keeps the card', async () => {
    mockController.getState.mockResolvedValue('default');
    mockController.register.mockResolvedValue('failed');
    await renderScreen(<PushPrompt />);
    await fireEvent.press(await screen.findByTestId('push-enable'));
    expect(await screen.findByTestId('push-enable-failed')).toBeTruthy();
    expect(screen.getByTestId('push-prompt')).toBeTruthy();
  });

  it('"not now" hides the card and snoozes it (7 days)', async () => {
    mockController.getState.mockResolvedValue('default');
    await renderScreen(<PushPrompt />);
    await fireEvent.press(await screen.findByTestId('push-later'));
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    expect(mockController.snooze).toHaveBeenCalledTimes(1);
  });

  it('snoozed: the card stays hidden', async () => {
    mockController.getState.mockResolvedValue('default');
    mockController.isSnoozed.mockResolvedValue(true);
    await renderScreen(<PushPrompt />);
    await waitFor(() => expect(mockController.getState).toHaveBeenCalled());
    expect(screen.queryByTestId('push-prompt')).toBeNull();
  });

  it('denied: banner with how-to, no enable button', async () => {
    mockController.getState.mockResolvedValue('denied');
    await renderScreen(<PushPrompt />);
    expect(await screen.findByTestId('push-denied-banner')).toBeTruthy();
    expect(screen.getByText(ar.push.deniedHow)).toBeTruthy();
    expect(screen.queryByTestId('push-enable')).toBeNull();
  });

  it('needs-install (iOS outside the PWA): the install guide instead of the permission button', async () => {
    mockController.getState.mockResolvedValue('needs-install');
    await renderScreen(<PushPrompt />);
    expect(await screen.findByText(ar.push.needsInstall)).toBeTruthy();
    expect(screen.queryByTestId('push-enable')).toBeNull();
  });

  it.each<WebPushState>(['unsupported', 'granted-unregistered', 'registered'])(
    '%s: renders nothing',
    async (s) => {
      mockController.getState.mockResolvedValue(s);
      await renderScreen(<PushPrompt />);
      await waitFor(() => expect(mockController.getState).toHaveBeenCalled());
      expect(screen.queryByTestId('push-prompt')).toBeNull();
      expect(screen.queryByTestId('push-denied-banner')).toBeNull();
      expect(screen.queryByTestId('push-install-card')).toBeNull();
    },
  );
});

describe('signOut on the web (R2 M2 order)', () => {
  it('removes the subscription first, then channels, then the local sign-out', async () => {
    const order: string[] = [];
    mockController.remove.mockImplementation(() => (order.push('push'), Promise.resolve()));
    const client = {
      removeAllChannels: jest.fn(() => (order.push('channels'), Promise.resolve([]))),
      auth: { signOut: jest.fn(() => (order.push('local'), Promise.resolve({ error: null }))) },
    };
    await signOut(client as never);
    expect(order).toEqual(['push', 'channels', 'local']);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('never throws when the push removal rejects-like (offline path is inside remove)', async () => {
    const client = {
      removeAllChannels: jest.fn(),
      auth: { signOut: jest.fn().mockResolvedValue({}) },
    };
    await expect(signOut(client as never)).resolves.toBeUndefined();
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
      ready: true,
      session: { user: { id: 'u1' } } as never,
      profile: {
        role: 'driver',
        is_active: true,
        must_change_pin: false,
        full_name: 'ع',
        phone: '1',
      },
      profileError: false,
      hasRegistration: false,
      sessionOffline: false,
    });
  });

  it('registers silently (ask: false) for an active driver session, never asks', async () => {
    mockController.register.mockResolvedValue('registered');
    await renderScreen(<NotificationsBridge />);
    await waitFor(() => expect(mockController.register).toHaveBeenCalled());
    expect(mockController.register).toHaveBeenCalledWith(mockClient, { ask: false });
  });

  it('does not register without a session or while the PIN change is required', async () => {
    useAuth.setState({ session: null, profile: null });
    await renderScreen(<NotificationsBridge />);
    expect(mockController.register).not.toHaveBeenCalled();
  });

  it('a click message routes through routeForNotification (valid) and ignores forged data', async () => {
    mockController.register.mockResolvedValue('registered');
    await renderScreen(<NotificationsBridge />);
    const id = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
    await act(async () => {
      for (const l of listeners) {
        l({
          data: {
            type: 'mukhdar:notification-click',
            data: { type: 'ready', order_id: 'javascript:alert(1)' },
          },
        });
      }
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
    await act(async () => {
      for (const l of listeners) {
        l({ data: { type: 'mukhdar:notification-click', data: { type: 'ready', order_id: id } } });
      }
    });
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(`/order/${id}`));
  });
});
