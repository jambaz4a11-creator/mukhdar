// بانتظار الموافقة (SPEC-driver §2.4): الحالات الست، الاستطلاع كل 30 ثانية والشاشة ظاهرة، وتوقفه بالخلفية.
import { NETWORK_ERROR_MESSAGE, type MukhdarClient } from '@mukhdar/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import PendingScreen from '../app/auth/pending';
import { fetchRequestStatus, pendingOutcome, startPendingPoll } from '../features/auth/pendingPoll';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { loadRegistration, saveRegistration, saveSecret } from '../lib/secureStore';
import { createFakeSupabase, type Result } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('../config', () => ({
  config: {
    supabaseUrl: 'https://x.supabase.co',
    supabaseKey: 'k',
    shopPhone: '',
    shopWhatsapp: '',
  },
  isSupabaseConfigured: () => true,
}));
const mockReplace = jest.fn();
jest.mock('expo-router', () => {
  // useFocusEffect: يُستدعى عند التركيب كالتركيز الأول
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { replace: (...a: unknown[]) => mockReplace(...a) },
    useFocusEffect: (cb: () => (() => void) | undefined) => useEffect(cb, [cb]),
  };
});

const SECRET = 's'.repeat(43);

async function saveRequest() {
  await saveSecret(SECRET);
  await saveRegistration({ requestId: 'r1', fullName: 'علي حسين', phone: '+9647805551212' });
}

describe('pendingOutcome', () => {
  it.each([
    ['pending', 'pending'],
    ['approved', 'set-pin'],
    ['rejected', 'rejected'],
    ['expired', 'expired'],
    ['completed', 'login'],
    ['not_found', 'register'],
  ])('%s -> %s', (status, outcome) => {
    expect(pendingOutcome(status)).toBe(outcome);
  });

  it('unknown value is an error, not a decision', () => {
    expect(pendingOutcome('weird')).toBeNull();
  });
});

describe('fetchRequestStatus', () => {
  it('calls the anon RPC with the saved id and secret', async () => {
    const fake = createFakeSupabase(() => ({ data: 'pending', error: null }));
    const status = await fetchRequestStatus(fake.client as unknown as MukhdarClient, {
      requestId: 'r1',
      secret: SECRET,
    });
    expect(status).toBe('pending');
    expect(fake.calls[0]).toEqual({
      table: 'rpc:driver_request_status',
      ops: [['rpc', [{ p_request_id: 'r1', p_device_secret: SECRET }]]],
    });
  });
});

describe('startPendingPoll', () => {
  type Listener = (s: string) => void;
  function fakeAppState(initial = 'active') {
    let listener: Listener = () => undefined;
    const remove = jest.fn();
    return {
      appState: {
        currentState: initial,
        addEventListener: (_: 'change', l: Listener) => {
          listener = l;
          return { remove };
        },
      },
      change: (s: string) => listener(s),
      remove,
    };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('checks on open and every 30 s', () => {
    const check = jest.fn();
    const { appState } = fakeAppState();
    const stop = startPendingPoll(check, { appState });
    expect(check).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(30_000);
    expect(check).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(60_000);
    expect(check).toHaveBeenCalledTimes(4);
    stop();
  });

  it('pauses in the background and checks again on return', () => {
    const check = jest.fn();
    const a = fakeAppState();
    const stop = startPendingPoll(check, { appState: a.appState });
    a.change('background');
    jest.advanceTimersByTime(120_000);
    expect(check).toHaveBeenCalledTimes(1);
    a.change('active');
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stop (screen hidden) clears the timer and the listener', () => {
    const check = jest.fn();
    const a = fakeAppState();
    const stop = startPendingPoll(check, { appState: a.appState });
    stop();
    jest.advanceTimersByTime(120_000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(a.remove).toHaveBeenCalled();
  });
});

describe('Pending screen', () => {
  function setup(status: () => Result) {
    const fake = createFakeSupabase((call) =>
      call.table === 'rpc:driver_request_status' ? status() : { data: null, error: null },
    );
    mockClient = fake.client;
    return fake;
  }

  beforeEach(async () => {
    mockReplace.mockClear();
    jest.spyOn(AppState, 'addEventListener');
    useAuth.setState({ hasRegistration: true });
    await saveRequest();
  });

  it('shows the saved name and phone with the pending badge; the button re-checks', async () => {
    const fake = setup(() => ({ data: 'pending', error: null }));
    await renderScreen(<PendingScreen />);
    expect(await screen.findByText(ar.pending.title)).toBeTruthy();
    expect(screen.getByText(/علي حسين/)).toBeTruthy();
    expect(screen.getByText('07805551212')).toBeTruthy();
    expect(screen.getByText(ar.pending.badge)).toBeTruthy();
    await waitFor(() => expect(fake.calls).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('pending-check'));
    await waitFor(() => expect(fake.calls).toHaveLength(2));
  });

  it('approved -> set-pin', async () => {
    setup(() => ({ data: 'approved', error: null }));
    await renderScreen(<PendingScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/set-pin'));
  });

  it('rejected -> message and "طلب جديد" clears the device and opens Register', async () => {
    setup(() => ({ data: 'rejected', error: null }));
    await renderScreen(<PendingScreen />);
    expect(await screen.findByText(ar.pending.rejectedTitle)).toBeTruthy();
    await fireEvent.press(screen.getByText(ar.pending.newRequest));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/register'));
    expect(await loadRegistration()).toBeNull();
    expect(useAuth.getState().hasRegistration).toBe(false);
  });

  it('expired -> message and "طلب جديد"', async () => {
    setup(() => ({ data: 'expired', error: null }));
    await renderScreen(<PendingScreen />);
    expect(await screen.findByText(ar.pending.expiredTitle)).toBeTruthy();
    expect(screen.getByText(ar.pending.newRequest)).toBeTruthy();
  });

  it('completed -> clears the device, Login with "حسابك جاهز"', async () => {
    setup(() => ({ data: 'completed', error: null }));
    await renderScreen(<PendingScreen />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/auth/login',
        params: { notice: 'ready' },
      }),
    );
    expect(await loadRegistration()).toBeNull();
  });

  it('not_found -> clears the device, Register', async () => {
    setup(() => ({ data: 'not_found', error: null }));
    await renderScreen(<PendingScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/register'));
    expect(await loadRegistration()).toBeNull();
  });

  it('network failure: message, stays', async () => {
    setup(() => ({ data: null, error: { message: 'Network request failed' } }));
    await renderScreen(<PendingScreen />);
    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(await loadRegistration()).not.toBeNull();
  });

  it('"إلغاء وتسجيل برقم ثاني" clears only the device', async () => {
    const fake = setup(() => ({ data: 'pending', error: null }));
    await renderScreen(<PendingScreen />);
    await waitFor(() => expect(fake.calls).toHaveLength(1));
    await act(() => fireEvent.press(screen.getByText(ar.pending.cancel)));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/register'));
    expect(await loadRegistration()).toBeNull();
    expect(fake.calls.filter((c) => !c.table.startsWith('rpc:driver_request_status'))).toEqual([]);
  });
});
