// وحدة (T10): حارس التوجيه يرجع للمسار الأصلي، رابط واتساب، عرض الرقم، تخزين الجلسة المقسّم، وحالة الجلسة.
import type { MukhdarClient } from '@mukhdar/shared';
import { displayPhone, forgotPinWhatsappUrl } from '../features/auth/api';
import { safeRedirect, SIGN_IN, signInHref } from '../features/auth/redirect';
import { initAuth, useAuth } from '../features/auth/store';
import { CHUNK_SIZE, secureStorage } from '../lib/secureStorage';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(k)) return Promise.reject(new Error(`invalid key ${k}`));
    if (v.length > 2048) return Promise.reject(new Error('value too large'));
    mockStore.set(k, v);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  }),
}));

describe('redirect after sign-in', () => {
  it('keeps an internal path (the screen the user came from)', () => {
    expect(safeRedirect('/orders')).toBe('/orders');
    expect(safeRedirect('/product/42')).toBe('/product/42');
    expect(safeRedirect(['/checkout'])).toBe('/checkout');
    expect(signInHref('/account')).toEqual({
      pathname: SIGN_IN,
      params: { redirect: '/account' },
    });
  });

  it('falls back to home for anything unsafe or missing', () => {
    for (const bad of [
      undefined,
      '',
      'orders',
      '//evil.com',
      'https://evil.com',
      '/\\evil.com',
      '/auth/sign-in',
      '/auth/name',
      '/auth',
      42,
    ]) {
      expect(safeRedirect(bad)).toBe('/');
    }
    expect(safeRedirect('/authors')).toBe('/authors');
  });
});

describe('forgot PIN (WhatsApp)', () => {
  it('opens the shop chat with a ready message including the customer number', () => {
    const url = forgotPinWhatsappUrl('+964 780 111 2222', '٠٧٧٠ ١٢٣ ٤٥٦٧');
    expect(url).toBe(
      `https://wa.me/9647801112222?text=${encodeURIComponent('نسيت رمز الدخول، رقمي 07701234567')}`,
    );
    expect(forgotPinWhatsappUrl('9647801112222', '')).toBe(
      `https://wa.me/9647801112222?text=${encodeURIComponent('نسيت رمز الدخول')}`,
    );
  });

  it('is hidden (null) while the shop number is the placeholder or empty', () => {
    expect(forgotPinWhatsappUrl('', '07701234567')).toBeNull();
    expect(forgotPinWhatsappUrl('9647XXXXXXXXX', '07701234567')).toBeNull();
  });
});

it('displayPhone shows 07XXXXXXXXX', () => {
  expect(displayPhone('9647701234567')).toBe('07701234567');
  expect(displayPhone(undefined)).toBe('');
});

describe('secureStorage (session in expo-secure-store)', () => {
  beforeEach(() => mockStore.clear());

  it('splits a large session into chunks under the 2048-byte limit and reads it back', async () => {
    const session = JSON.stringify({ access_token: 'a'.repeat(3000), refresh_token: 'r' });
    await secureStorage.setItem('sb-ghco-auth-token', session);
    expect(mockStore.get('sb-ghco-auth-token.n')).toBe(
      String(Math.ceil(session.length / CHUNK_SIZE)),
    );
    expect([...mockStore.values()].every((v) => v.length <= 2048)).toBe(true);
    expect(await secureStorage.getItem('sb-ghco-auth-token')).toBe(session);
  });

  it('a shorter value removes leftover chunks; remove clears everything', async () => {
    await secureStorage.setItem('k', 'x'.repeat(CHUNK_SIZE * 3));
    await secureStorage.setItem('k', 'short');
    expect([...mockStore.keys()].sort()).toEqual(['k.0', 'k.n']);
    expect(await secureStorage.getItem('k')).toBe('short');
    await secureStorage.removeItem('k');
    expect(mockStore.size).toBe(0);
    expect(await secureStorage.getItem('k')).toBeNull();
  });

  it('invalid key characters are replaced; a missing chunk reads as no session', async () => {
    await secureStorage.setItem('a b:c', 'v');
    expect(mockStore.get('a_b_c.0')).toBe('v');
    mockStore.set('broken.n', '2');
    mockStore.set('broken.0', 'half');
    expect(await secureStorage.getItem('broken')).toBeNull();
  });
});

describe('initAuth', () => {
  it('reads the saved session, follows auth changes, and unsubscribes', async () => {
    let listener: ((event: string, session: unknown) => void) | undefined;
    const unsubscribe = jest.fn();
    const client = {
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
        onAuthStateChange: (cb: typeof listener) => {
          listener = cb;
          return { data: { subscription: { unsubscribe } } };
        },
        startAutoRefresh: jest.fn(() => Promise.resolve()),
        stopAutoRefresh: jest.fn(() => Promise.resolve()),
      },
    } as unknown as MukhdarClient;
    useAuth.setState({ session: null, ready: false });
    const stop = initAuth(client);
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuth.getState()).toMatchObject({ ready: true, session: { user: { id: 'u1' } } });
    listener?.('SIGNED_OUT', null);
    expect(useAuth.getState()).toEqual({ ready: true, session: null, mustChangePin: false });
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('without a configured client: ready, no session', () => {
    useAuth.setState({ session: null, ready: false });
    initAuth(null);
    expect(useAuth.getState()).toEqual({ ready: true, session: null, mustChangePin: false });
  });
});
