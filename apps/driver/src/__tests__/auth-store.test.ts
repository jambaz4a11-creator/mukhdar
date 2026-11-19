// حالة الجلسة والملف الشخصي (SPEC-driver §2.1، DRIVER-API §2.3–§2.4).
import type { MukhdarClient } from '@mukhdar/shared';
import { initAuth, refreshProfile, useAuth } from '../features/auth/store';
import { saveRegistration, saveSecret } from '../lib/secureStore';
import { createFakeSupabase, type Result } from '../test-utils/fakeSupabase';

const SESSION = { user: { id: 'u1', phone: '9647801112222' }, access_token: 't' };
const DRIVER = {
  role: 'driver',
  is_active: true,
  must_change_pin: false,
  full_name: 'علي',
  phone: '9647801112222',
};

type Listener = (event: string, session: unknown) => void;

function setup(opts: { getSession?: () => unknown; profile?: () => Result } = {}) {
  let listener: Listener = () => undefined;
  const auth = {
    getSession: jest.fn(() =>
      Promise.resolve(opts.getSession?.() ?? { data: { session: null }, error: null }),
    ),
    onAuthStateChange: jest.fn((l: Listener) => {
      listener = l;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
    signOut: jest.fn(() => Promise.resolve({ error: null })),
  };
  const fake = createFakeSupabase(
    (call) =>
      call.table === 'profiles'
        ? (opts.profile?.() ?? { data: DRIVER, error: null })
        : { data: null, error: null },
    auth,
  );
  const stop = initAuth(fake.client as unknown as MukhdarClient);
  return { ...fake, auth, stop, emit: (e: string, s: unknown) => listener(e, s) };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  useAuth.setState({
    ready: false,
    session: null,
    profile: null,
    profileError: false,
    hasRegistration: false,
  });
});

it('no session: ready without a profile; notes a saved request', async () => {
  await saveSecret('s'.repeat(43));
  await saveRegistration({ requestId: 'r1', fullName: 'علي', phone: '+9647801112222' });
  const { stop } = setup();
  await settle();
  expect(useAuth.getState()).toMatchObject({ ready: true, session: null, hasRegistration: true });
  stop();
});

it('saved session: reads role, is_active, must_change_pin from profiles', async () => {
  const { calls, stop } = setup({
    getSession: () => ({ data: { session: SESSION }, error: null }),
  });
  await settle();
  expect(useAuth.getState().profile).toEqual(DRIVER);
  const profileCall = calls.find((c) => c.table === 'profiles');
  expect(profileCall?.ops).toEqual(
    expect.arrayContaining([
      ['select', ['role, is_active, must_change_pin, full_name, phone']],
      ['eq', ['id', 'u1']],
    ]),
  );
  stop();
});

it('session refresh failed (HTTP 400, revoked): local sign-out, no session', async () => {
  const { auth, stop } = setup({
    getSession: () => ({
      data: { session: null },
      error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' },
    }),
  });
  await settle();
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(useAuth.getState()).toMatchObject({ ready: true, session: null });
  stop();
});

it('profile read rejected as unauthenticated (401): local sign-out', async () => {
  const { auth, stop } = setup({
    getSession: () => ({ data: { session: SESSION }, error: null }),
    profile: () => ({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }),
  });
  await settle();
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  stop();
});

it('profile read failed (network): keeps state, flags the error', async () => {
  const { auth, stop } = setup({
    getSession: () => ({ data: { session: SESSION }, error: null }),
    profile: () => ({ data: null, error: { message: 'Network request failed' } }),
  });
  await settle();
  expect(useAuth.getState()).toMatchObject({ profile: null, profileError: true });
  expect(auth.signOut).not.toHaveBeenCalled();
  stop();
});

it('signing in reads the profile; signing out clears it', async () => {
  const { client, emit, stop } = setup();
  await settle();
  emit('SIGNED_IN', SESSION);
  await settle();
  expect(useAuth.getState().profile).toEqual(DRIVER);
  emit('SIGNED_OUT', null);
  expect(useAuth.getState()).toMatchObject({ session: null, profile: null });
  // نتيجة لمستخدم خرج لا تُكتب
  await refreshProfile(client as unknown as MukhdarClient);
  expect(useAuth.getState().profile).toBeNull();
  stop();
});
