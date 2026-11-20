// تغيير الرمز المؤقت الإجباري (DRIVER-API §2.3) و"حسابك غير مفعّل كسائق" (SPEC-driver §2.1).
import { PIN_CHANGE_MESSAGES } from '@mukhdar/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import ChangePinScreen from '../app/auth/change-pin';
import NotDriverScreen from '../app/auth/not-driver';
import OfflineScreen from '../app/auth/offline';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { createFakeSupabase } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const SESSION = { user: { id: 'u1', phone: '9647805551212' } } as never;
const PROFILE = {
  role: 'driver',
  is_active: true,
  must_change_pin: true,
  full_name: 'علي',
  phone: '9647805551212',
};

function setup(opts: { signIn?: unknown; profile?: object } = {}) {
  const auth = {
    signInWithPassword: jest.fn(() => Promise.resolve(opts.signIn ?? { error: null })),
    updateUser: jest.fn(() => Promise.resolve({ error: null })),
    signOut: jest.fn(() => Promise.resolve({ error: null })),
  };
  const fake = createFakeSupabase(
    (call) =>
      call.table === 'profiles'
        ? { data: opts.profile ?? { ...PROFILE, must_change_pin: false }, error: null }
        : { data: null, error: null },
    auth,
  );
  mockClient = fake.client;
  return { ...fake, auth };
}

beforeEach(() => {
  useAuth.setState({
    ready: true,
    session: SESSION,
    profile: PROFILE,
    profileError: false,
    hasRegistration: false,
  });
});

describe('forced PIN change', () => {
  async function enter(current: string, next: string, confirm = next) {
    await renderScreen(<ChangePinScreen />);
    await fireEvent.changeText(screen.getByTestId('pin-current'), current);
    await fireEvent.changeText(screen.getByTestId('pin-new'), next);
    await fireEvent.changeText(screen.getByTestId('pin-confirm'), confirm);
    await fireEvent.press(screen.getByTestId('pin-submit'));
  }

  it('no skipping: hardware back is swallowed; only sign-out is offered', async () => {
    const spy = jest.spyOn(BackHandler, 'addEventListener');
    setup();
    await renderScreen(<ChangePinScreen />);
    const handler = spy.mock.calls.find(([e]) => e === 'hardwareBackPress')?.[1];
    expect((handler as (() => boolean) | undefined)?.()).toBe(true);
    expect(screen.queryByTestId('back')).toBeNull();
    expect(screen.getByTestId('pin-sign-out')).toBeTruthy();
  });

  it('temp PIN -> new PIN: verify, update, revoke others, re-read the profile (flag cleared)', async () => {
    const t = setup();
    await enter('111999', '730514');
    await waitFor(() => expect(useAuth.getState().profile?.must_change_pin).toBe(false));
    expect(t.auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647805551212',
      password: '111999',
    });
    expect(t.auth.updateUser).toHaveBeenCalledWith({ password: '730514' });
    expect(t.auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('wrong temporary PIN -> message on screen', async () => {
    setup({ signIn: { error: { code: 'invalid_credentials' } } });
    await enter('111999', '730514');
    expect(await screen.findByText(PIN_CHANGE_MESSAGES.wrongCurrent)).toBeTruthy();
  });

  it('sign out ends the session', async () => {
    const t = setup();
    await renderScreen(<ChangePinScreen />);
    await fireEvent.press(screen.getByTestId('pin-sign-out'));
    await waitFor(() => expect(useAuth.getState().session).toBeNull());
    expect(t.auth.signOut).toHaveBeenCalled();
  });
});

describe('not a driver', () => {
  beforeEach(() =>
    useAuth.setState({ profile: { ...PROFILE, must_change_pin: false, role: 'customer' } }),
  );

  it('shows the message; refresh re-reads the profile', async () => {
    const t = setup({ profile: { ...PROFILE, must_change_pin: false } });
    await renderScreen(<NotDriverScreen />);
    expect(screen.getByText(ar.notDriver.title)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('not-driver-refresh'));
    await waitFor(() => expect(useAuth.getState().profile?.role).toBe('driver'));
    expect(t.calls.some((c) => c.table === 'profiles')).toBe(true);
  });

  it('sign out', async () => {
    setup();
    await renderScreen(<NotDriverScreen />);
    await fireEvent.press(screen.getByTestId('not-driver-sign-out'));
    await waitFor(() => expect(useAuth.getState().session).toBeNull());
  });
});

describe('R1 M2: offline screen', () => {
  beforeEach(() => useAuth.setState({ session: null, profile: null, sessionOffline: true }));

  it('shows "ماكو اتصال"; retry re-reads the session and clears the state when the network is back', async () => {
    const auth = {
      getSession: jest.fn(() => Promise.resolve({ data: { session: SESSION }, error: null })),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
    };
    const fake = createFakeSupabase(
      () => ({ data: { ...PROFILE, must_change_pin: false }, error: null }),
      auth,
    );
    mockClient = fake.client;
    await renderScreen(<OfflineScreen />);
    expect(screen.getByText(ar.offline.title)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('offline-retry'));
    await waitFor(() => expect(useAuth.getState().sessionOffline).toBe(false));
    expect(useAuth.getState().session).toEqual(SESSION);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('retry while still offline keeps the screen and never signs out', async () => {
    const auth = {
      getSession: jest.fn(() =>
        Promise.resolve({
          data: { session: null },
          error: { name: 'AuthRetryableFetchError', status: 0 },
        }),
      ),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
    };
    mockClient = createFakeSupabase(() => ({ data: null, error: null }), auth).client;
    await renderScreen(<OfflineScreen />);
    await fireEvent.press(screen.getByTestId('offline-retry'));
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    expect(useAuth.getState().sessionOffline).toBe(true);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
