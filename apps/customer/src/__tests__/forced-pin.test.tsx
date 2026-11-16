// تغيير الرمز الإجباري (مراجعة جلسة C، M3): الحارس يعيد المستخدم برمز مؤقت لشاشة التغيير عند إعادة التشغيل
// بجلسة محفوظة، وعند الروابط العميقة، وعند الرجوع، والعودة للتطبيق؛ ولا يفعل شيئاً بغيرها. Supabase مزيف.
import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { ForcedPinGuard } from '../features/auth/ForcedPinGuard';
import { forcedPinRedirect } from '../features/auth/forcedPin';
import { initAuth, useAuth } from '../features/auth/store';
import { createFakeSupabase, type Call, type Result } from '../test-utils/fakeSupabase';

const SESSION = { user: { id: 'u1', phone: '9647701234567' }, access_token: 't' };

// ------------------------------------------------------------------ mocks
const mockReplace = jest.fn();
let mockPathname = '/';
let mockNavKey: string | undefined = 'root';
jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
  usePathname: () => mockPathname,
  useRootNavigationState: () => ({ key: mockNavKey }),
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockPathname = '/';
  mockNavKey = 'root';
  useAuth.setState({ session: null, ready: false, mustChangePin: false });
});

const forced = (pathname: string) => ({
  pathname: '/account/pin',
  params: { forced: '1', redirect: pathname },
});

describe('forcedPinRedirect', () => {
  const base = { ready: true, session: SESSION as never, mustChangePin: true, pathname: '/' };

  it('sends a flagged signed-in user to the forced PIN screen, remembering where they were going', () => {
    expect(forcedPinRedirect({ ...base, pathname: '/order/5' })).toEqual(forced('/order/5'));
    expect(forcedPinRedirect({ ...base, pathname: '/checkout' })).toEqual(forced('/checkout'));
  });

  it('does nothing before the session is read, when signed out, or when not flagged', () => {
    expect(forcedPinRedirect({ ...base, ready: false })).toBeNull();
    expect(forcedPinRedirect({ ...base, session: null })).toBeNull();
    expect(forcedPinRedirect({ ...base, mustChangePin: false })).toBeNull();
  });

  it('does nothing on the PIN screen itself (no redirect loop)', () => {
    expect(forcedPinRedirect({ ...base, pathname: '/account/pin' })).toBeNull();
  });

  it('never carries an auth screen as the return target', () => {
    expect(forcedPinRedirect({ ...base, pathname: '/auth/sign-in' })?.params.redirect).toBe('/');
  });
});

describe('ForcedPinGuard', () => {
  it('redirects on mount when a restored session is flagged (app restart)', async () => {
    useAuth.setState({ session: SESSION as never, ready: true, mustChangePin: true });
    mockPathname = '/';
    await render(<ForcedPinGuard />);
    expect(mockReplace).toHaveBeenCalledWith(forced('/'));
  });

  it('redirects a deep link and a back navigation to another screen', async () => {
    useAuth.setState({ session: SESSION as never, ready: true, mustChangePin: true });
    mockPathname = '/account/pin';
    const view = await render(<ForcedPinGuard />);
    expect(mockReplace).not.toHaveBeenCalled();
    // رابط عميق، أو رجوع (Android back / swipe) لشاشة تحت شاشة الدخول
    mockPathname = '/order/9';
    await view.rerender(<ForcedPinGuard />);
    expect(mockReplace).toHaveBeenLastCalledWith(forced('/order/9'));
    mockPathname = '/cart';
    await view.rerender(<ForcedPinGuard />);
    expect(mockReplace).toHaveBeenLastCalledWith(forced('/cart'));
  });

  it('reacts when the flag turns on later (checkout got PIN_CHANGE_REQUIRED)', async () => {
    useAuth.setState({ session: SESSION as never, ready: true, mustChangePin: false });
    mockPathname = '/checkout';
    await render(<ForcedPinGuard />);
    expect(mockReplace).not.toHaveBeenCalled();
    await act(async () => {
      useAuth.setState({ mustChangePin: true });
    });
    expect(mockReplace).toHaveBeenCalledWith(forced('/checkout'));
  });

  it('stays quiet for an unflagged user, a guest, and until the navigator is ready', async () => {
    useAuth.setState({ session: SESSION as never, ready: true, mustChangePin: false });
    const a = await render(<ForcedPinGuard />);
    await a.unmount();
    useAuth.setState({ session: null, ready: true, mustChangePin: true });
    const b = await render(<ForcedPinGuard />);
    await b.unmount();
    mockNavKey = undefined;
    useAuth.setState({ session: SESSION as never, ready: true, mustChangePin: true });
    await render(<ForcedPinGuard />);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('initAuth reads the flag', () => {
  type Listener = (event: string, session: unknown) => void;

  function clientWith(opts: { session: unknown; flag: boolean | 'error' }) {
    const fake = createFakeSupabase((call: Call): Result => {
      if (call.table === 'profiles') {
        return opts.flag === 'error'
          ? { data: null, error: { message: 'offline' } }
          : { data: { must_change_pin: opts.flag }, error: null };
      }
      return { data: null, error: null };
    });
    let listener: Listener | undefined;
    const auth = {
      getSession: jest.fn(() => Promise.resolve({ data: { session: opts.session } })),
      onAuthStateChange: jest.fn((cb: Listener) => {
        listener = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      startAutoRefresh: jest.fn(() => Promise.resolve()),
      stopAutoRefresh: jest.fn(() => Promise.resolve()),
    };
    return {
      client: { ...fake.client, auth } as never,
      emit: (e: string, s: unknown) => listener?.(e, s),
    };
  }
  // لا مكوّن مرسوم هنا (المخزن فقط): انتظار بسيط بلا act
  const flush = () => new Promise<void>((r) => setTimeout(r, 5));

  it('persisted session + flagged profile gives mustChangePin after restore', async () => {
    const { client } = clientWith({ session: SESSION, flag: true });
    const stop = initAuth(client);
    await flush();
    expect(useAuth.getState()).toMatchObject({ ready: true, mustChangePin: true });
    stop();
  });

  it('persisted session + normal profile is not forced', async () => {
    const { client } = clientWith({ session: SESSION, flag: false });
    const stop = initAuth(client);
    await flush();
    expect(useAuth.getState().mustChangePin).toBe(false);
    stop();
  });

  it('a failed read (offline) leaves the state alone; the server still refuses orders', async () => {
    useAuth.setState({ mustChangePin: true });
    const { client } = clientWith({ session: SESSION, flag: 'error' });
    const stop = initAuth(client);
    await flush();
    expect(useAuth.getState().mustChangePin).toBe(true);
    stop();
  });

  it('signing out clears the flag so the next user does not inherit it', async () => {
    const { client, emit } = clientWith({ session: SESSION, flag: true });
    const stop = initAuth(client);
    await flush();
    expect(useAuth.getState().mustChangePin).toBe(true);
    emit('SIGNED_OUT', null);
    expect(useAuth.getState()).toMatchObject({ session: null, mustChangePin: false });
    stop();
  });

  it('a new sign-in re-reads the flag', async () => {
    const { client, emit } = clientWith({ session: null, flag: true });
    const stop = initAuth(client);
    await flush();
    emit('SIGNED_IN', SESSION);
    await flush();
    expect(useAuth.getState().mustChangePin).toBe(true);
    stop();
  });

  it('coming back to the foreground re-reads it (the store may have reset the PIN meanwhile)', async () => {
    const handlers: ((s: string) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      handler: (s: string) => void,
    ) => {
      handlers.push(handler);
      return { remove: jest.fn() };
    }) as never);
    let flag = false;
    const fake = createFakeSupabase((call: Call): Result =>
      call.table === 'profiles'
        ? { data: { must_change_pin: flag }, error: null }
        : { data: null, error: null },
    );
    const auth = {
      getSession: () => Promise.resolve({ data: { session: SESSION } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
      startAutoRefresh: () => Promise.resolve(),
      stopAutoRefresh: () => Promise.resolve(),
    };
    const stop = initAuth({ ...fake.client, auth } as never);
    await flush();
    expect(useAuth.getState().mustChangePin).toBe(false);
    flag = true;
    handlers.forEach((h) => h('active'));
    await flush();
    expect(useAuth.getState().mustChangePin).toBe(true);
    stop();
    spy.mockRestore();
  });
});
