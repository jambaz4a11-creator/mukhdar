// الحارس (SPEC-driver §2.1) كدالة صرفة لكل حالة.
import { guardRedirect, isGuardBlocking, type GuardState } from '../features/auth/guard';

const DRIVER = {
  role: 'driver',
  is_active: true,
  must_change_pin: false,
  full_name: 'علي',
  phone: '9647801112222',
};
const session = { user: { id: 'u1' } };
const base: GuardState = {
  ready: true,
  session: null,
  profile: null,
  profileError: false,
  hasRegistration: false,
};

describe('guardRedirect', () => {
  it('waits until the session and the saved request are read', () => {
    expect(guardRedirect({ ...base, ready: false }, '/')).toBeNull();
    expect(isGuardBlocking({ ...base, ready: false })).toBe(true);
  });

  it('no session, no saved request: login (register allowed)', () => {
    expect(guardRedirect(base, '/')).toBe('/auth/login');
    expect(guardRedirect(base, '/auth/pending')).toBe('/auth/login');
    expect(guardRedirect(base, '/auth/login')).toBeNull();
    expect(guardRedirect(base, '/auth/register')).toBeNull();
  });

  it('no session, saved request: pending (set-pin allowed)', () => {
    const s = { ...base, hasRegistration: true };
    expect(guardRedirect(s, '/')).toBe('/auth/pending');
    expect(guardRedirect(s, '/auth/login')).toBe('/auth/pending');
    expect(guardRedirect(s, '/auth/pending')).toBeNull();
    expect(guardRedirect(s, '/auth/set-pin')).toBeNull();
  });

  it('session while the profile loads: wait (blocking overlay)', () => {
    const s = { ...base, session };
    expect(guardRedirect(s, '/auth/login')).toBeNull();
    expect(isGuardBlocking(s)).toBe(true);
  });

  it('temporary PIN: change-pin, nothing else', () => {
    const s = { ...base, session, profile: { ...DRIVER, must_change_pin: true } };
    expect(guardRedirect(s, '/')).toBe('/auth/change-pin');
    expect(guardRedirect(s, '/today')).toBe('/auth/change-pin');
    expect(guardRedirect(s, '/auth/change-pin')).toBeNull();
  });

  it('not a driver or deactivated: not-driver', () => {
    for (const profile of [
      { ...DRIVER, role: 'customer' },
      { ...DRIVER, role: 'staff' },
      { ...DRIVER, is_active: false },
      { ...DRIVER, role: null },
    ]) {
      const s = { ...base, session, profile };
      expect(guardRedirect(s, '/')).toBe('/auth/not-driver');
      expect(guardRedirect(s, '/auth/not-driver')).toBeNull();
    }
  });

  it('active driver: tabs, never the auth screens', () => {
    const s = { ...base, session, profile: DRIVER, hasRegistration: true };
    expect(guardRedirect(s, '/auth/login')).toBe('/');
    expect(guardRedirect(s, '/auth/set-pin')).toBe('/');
    expect(guardRedirect(s, '/auth/not-driver')).toBe('/');
    expect(guardRedirect(s, '/')).toBeNull();
    expect(guardRedirect(s, '/today')).toBeNull();
    expect(isGuardBlocking(s)).toBe(false);
  });

  it('profile unreadable (offline) with no known profile: leave auth screens, server enforces', () => {
    const s = { ...base, session, profileError: true };
    expect(isGuardBlocking(s)).toBe(false);
    expect(guardRedirect(s, '/auth/login')).toBe('/');
    expect(guardRedirect(s, '/')).toBeNull();
  });
});
