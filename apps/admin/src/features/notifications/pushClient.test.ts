import { describe, expect, it, vi } from 'vitest';
import { fetchVapidPublicKey, iosPushGate, sessionKey } from './pushClient';
import { deviceAlertCopy, whatArrives } from './text';

const KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const IPHONE_17 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_16_1 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1';
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function jwt(payload: object): string {
  const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.sig`;
}

describe('iosPushGate', () => {
  it('iPhone in a Safari tab needs the home-screen app; installed is ok; < 16.4 is too old', () => {
    expect(iosPushGate({ userAgent: IPHONE_17, maxTouchPoints: 5, standalone: false })).toBe(
      'needs-install',
    );
    expect(iosPushGate({ userAgent: IPHONE_17, maxTouchPoints: 5, standalone: true })).toBe('ok');
    expect(iosPushGate({ userAgent: IPHONE_16_1, maxTouchPoints: 5, standalone: true })).toBe(
      'too-old',
    );
  });
  it('PC and Android are never gated', () => {
    expect(iosPushGate({ userAgent: WINDOWS_CHROME, maxTouchPoints: 0, standalone: false })).toBe(
      'ok',
    );
  });
});

describe('sessionKey', () => {
  it('account + session, so a new sign-in re-registers at once', () => {
    expect(sessionKey(jwt({ sub: 'u1', session_id: 's1' }))).toBe('u1:s1');
    expect(sessionKey(jwt({ sub: 'u1', session_id: 's2' }))).toBe('u1:s2');
  });
  it('anything unreadable gives null (no throttling, never a throw)', () => {
    expect(sessionKey(jwt({ sub: 'u1' }))).toBeNull();
    expect(sessionKey('a.%%%.c')).toBeNull();
    expect(sessionKey('')).toBeNull();
    expect(sessionKey(null)).toBeNull();
  });
});

describe('fetchVapidPublicKey', () => {
  const client = (result: unknown, error: unknown = null) => ({
    functions: { invoke: vi.fn().mockResolvedValue({ data: result, error }) },
  });
  it('reads push-config at runtime (POST)', async () => {
    const c = client({ vapid_public_key: KEY });
    await expect(fetchVapidPublicKey(c as never, undefined)).resolves.toBe(KEY);
    expect(c.functions.invoke).toHaveBeenCalledWith('push-config', { method: 'POST' });
  });
  it('a build-time key wins without a request', async () => {
    const c = client({ vapid_public_key: 'other' });
    await expect(fetchVapidPublicKey(c as never, KEY)).resolves.toBe(KEY);
    expect(c.functions.invoke).not.toHaveBeenCalled();
  });
  it('error, missing or malformed key gives null (never subscribe with a bad key)', async () => {
    await expect(
      fetchVapidPublicKey(client(null, new Error('503')) as never, undefined),
    ).resolves.toBeNull();
    await expect(fetchVapidPublicKey(client({}) as never, undefined)).resolves.toBeNull();
    await expect(
      fetchVapidPublicKey(client({ vapid_public_key: 'k'.repeat(43) }) as never, undefined),
    ).resolves.toBeNull();
    await expect(fetchVapidPublicKey(client(null) as never, 'short')).resolves.toBeNull();
    const throwing = { functions: { invoke: vi.fn().mockRejectedValue(new Error('net')) } };
    await expect(fetchVapidPublicKey(throwing as never, undefined)).resolves.toBeNull();
  });
});

describe('device alert copy', () => {
  it('only registered offers "turn off"; default and granted-unregistered offer "turn on"', () => {
    expect(deviceAlertCopy('registered').action).toBe('disable');
    expect(deviceAlertCopy('default').action).toBe('enable');
    expect(deviceAlertCopy('granted-unregistered').action).toBe('enable');
    for (const s of [
      'denied',
      'needs-install',
      'ios-too-old',
      'not-configured',
      'unsupported',
    ] as const) {
      expect(deviceAlertCopy(s).action).toBeNull();
    }
    expect(deviceAlertCopy('needs-install').help).toContain('إضافة إلى الشاشة الرئيسية');
  });
  it('staff are not promised driver requests or low stock', () => {
    expect(whatArrives('staff')).not.toMatch(/سائق|المخزون/);
    expect(whatArrives('admin')).toMatch(/طلب سائق جديد/);
  });
});
