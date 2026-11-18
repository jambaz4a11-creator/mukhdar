// حكم الجلسة بالخادم (getPanelUser): خلل خادم/شبكة ← 'unavailable' (رسالة + إعادة محاولة)، ورفض حقيقي ← 'anonymous'
// (صفحة الدخول). الوصول ممنوع بالحالتين؛ الفرق فقط أن الموظف لا يُرمى للدخول بسبب خلل عابر.
import { describe, expect, it } from 'vitest';
import { getPanelUser, isServiceError } from './panelUser';

type AuthErr = { name: string; message: string; status?: number } | null;

function fake(opts: {
  userError?: AuthErr;
  userThrows?: boolean;
  profile?: Record<string, unknown> | null;
  profileError?: { message: string } | null;
  aalError?: AuthErr;
}) {
  const user = { id: 'u1', factors: [] };
  const supabase = {
    auth: {
      getUser: async () => {
        if (opts.userThrows) throw new TypeError('fetch failed');
        return opts.userError
          ? { data: { user: null }, error: opts.userError }
          : { data: { user }, error: null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async () =>
          opts.aalError
            ? { data: null, error: opts.aalError }
            : { data: { currentLevel: 'aal2' }, error: null },
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: opts.profile === undefined ? null : opts.profile,
            error: opts.profileError ?? null,
          }),
        }),
      }),
    }),
  };
  return supabase as unknown as Parameters<typeof getPanelUser>[0];
}

const staff = {
  role: 'staff',
  is_active: true,
  full_name: 'س',
  phone: '9647700000000',
  must_change_pin: false,
};

describe('isServiceError', () => {
  it.each([
    [{ name: 'AuthRetryableFetchError', status: 0 }, true],
    [{ name: 'AuthRetryableFetchError', status: 503 }, true],
    [{ name: 'AuthUnknownError' }, true],
    [{ name: 'AuthApiError', status: 500 }, true],
    [{ name: 'AuthApiError', status: 502 }, true],
    [{ name: 'AuthSessionMissingError', status: 400 }, false],
    [{ name: 'AuthApiError', status: 401 }, false],
    [{ name: 'AuthApiError', status: 403 }, false],
    [{ name: 'AuthApiError', status: 400 }, false],
    [null, false],
    ['x', false],
  ])('%j → %s', (err, expected) => {
    expect(isServiceError(err)).toBe(expected);
  });
});

describe('getPanelUser: server/network failure vs real invalid session', () => {
  it('a healthy staff session is ok', async () => {
    const u = await getPanelUser(fake({ profile: staff }));
    expect(u.state).toBe('ok');
  });

  it.each([
    ['network failure', { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 }],
    ['Cloudflare 1102 (503)', { name: 'AuthRetryableFetchError', message: 'x', status: 503 }],
    ['unparseable reply', { name: 'AuthUnknownError', message: 'x' }],
    ['server error 500', { name: 'AuthApiError', message: 'context canceled', status: 500 }],
  ])('getUser %s → unavailable (not anonymous)', async (_n, err) => {
    expect((await getPanelUser(fake({ userError: err }))).state).toBe('unavailable');
  });

  it('a thrown fetch error → unavailable', async () => {
    expect((await getPanelUser(fake({ userThrows: true }))).state).toBe('unavailable');
  });

  it.each([
    [
      'no session',
      { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 },
    ],
    ['invalid or expired token', { name: 'AuthApiError', message: 'invalid JWT', status: 401 }],
    ['session not found', { name: 'AuthApiError', message: 'session_not_found', status: 403 }],
  ])('getUser %s → anonymous (login page)', async (_n, err) => {
    expect((await getPanelUser(fake({ userError: err }))).state).toBe('anonymous');
  });

  it('profile read error → unavailable; missing, inactive or non-panel profile → forbidden', async () => {
    expect((await getPanelUser(fake({ profileError: { message: 'boom' } }))).state).toBe(
      'unavailable',
    );
    expect((await getPanelUser(fake({ profile: null }))).state).toBe('forbidden');
    expect((await getPanelUser(fake({ profile: { ...staff, is_active: false } }))).state).toBe(
      'forbidden',
    );
    expect((await getPanelUser(fake({ profile: { ...staff, role: 'customer' } }))).state).toBe(
      'forbidden',
    );
  });

  it('assurance level lookup failure → unavailable', async () => {
    const err = { name: 'AuthRetryableFetchError', message: 'x', status: 0 };
    expect((await getPanelUser(fake({ profile: staff, aalError: err }))).state).toBe('unavailable');
  });
});
