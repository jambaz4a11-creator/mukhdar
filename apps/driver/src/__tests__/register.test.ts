// التسجيل (SPEC-driver §2.3): سر الجهاز (32 بايت، base64url، يُحفظ قبل الإرسال)، الطلب، والأخطاء.
import { ERROR_MESSAGES, NETWORK_ERROR_MESSAGE, type MukhdarClient } from '@mukhdar/shared';
import * as Crypto from 'expo-crypto';
import {
  getOrCreateDeviceSecret,
  generateDeviceSecret,
  toBase64Url,
} from '../features/auth/deviceSecret';
import { submitRegistration } from '../features/auth/register';
import { ar } from '../i18n/ar';
import { loadRegistration, readSecret, saveSecret } from '../lib/secureStore';
import { createFakeSupabase, functionError, type Result } from '../test-utils/fakeSupabase';
import { secureStoreMemory } from '../test-utils/secureStoreMock';

const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;

describe('device secret', () => {
  it('base64url without padding', () => {
    expect(toBase64Url(Uint8Array.from([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(toBase64Url(Uint8Array.from([0x61]))).toBe('YQ');
    expect(toBase64Url(new Uint8Array(32))).toBe('A'.repeat(43));
  });

  it('32 random bytes from expo-crypto (CSPRNG) -> 43 characters', async () => {
    const secret = await generateDeviceSecret();
    expect(jest.mocked(Crypto.getRandomBytesAsync)).toHaveBeenCalledWith(32);
    expect(secret).toMatch(B64URL_43);
  });

  it('refuses a short random source', async () => {
    jest.mocked(Crypto.getRandomBytesAsync).mockResolvedValueOnce(new Uint8Array(16));
    await expect(generateDeviceSecret()).rejects.toThrow();
  });

  it('creates and stores once, then reuses (a retry keeps the same request on the server)', async () => {
    const first = await getOrCreateDeviceSecret();
    expect(await readSecret()).toBe(first);
    jest.mocked(Crypto.getRandomBytesAsync).mockClear();
    expect(await getOrCreateDeviceSecret()).toBe(first);
    expect(jest.mocked(Crypto.getRandomBytesAsync)).not.toHaveBeenCalled();
  });
});

describe('submitRegistration', () => {
  function setup(resolve: () => Result, pushToken: string | null = null) {
    let secretAtInvoke: string | undefined;
    const fake = createFakeSupabase((call) => {
      if (call.table === 'fn:driver-register') {
        secretAtInvoke = secureStoreMemory.get('mukhdar.driver.reg.secret');
        return resolve();
      }
      return { data: null, error: null };
    });
    const run = (name: string, phone: string) =>
      submitRegistration(
        fake.client as unknown as MukhdarClient,
        { fullName: name, phone },
        { getPushToken: () => Promise.resolve(pushToken) },
      );
    return { ...fake, run, secretAtInvoke: () => secretAtInvoke };
  }

  it('saves the secret before sending, sends the body, then saves the request', async () => {
    const t = setup(() => ({ data: { request_id: 'r1' }, error: null }), 'ExponentPushToken[abc]');
    const result = await t.run('  علي   حسين ', '٠٧٨٠ ١١١ ٢٢٢٢');
    expect(result).toEqual({ ok: true });
    const secret = await readSecret();
    expect(secret).toMatch(B64URL_43);
    expect(t.secretAtInvoke()).toBe(secret);
    expect(t.calls[0]?.ops[0]?.[1][0]).toEqual({
      full_name: 'علي حسين',
      phone: '+9647801112222',
      device_secret: secret,
      push_token: 'ExponentPushToken[abc]',
    });
    expect(await loadRegistration()).toEqual({
      requestId: 'r1',
      secret,
      fullName: 'علي حسين',
      phone: '+9647801112222',
    });
  });

  it('no push permission: push_token is left out', async () => {
    const t = setup(() => ({ data: { request_id: 'r1' }, error: null }));
    await t.run('علي حسين', '07801112222');
    expect(t.calls[0]?.ops[0]?.[1][0]).not.toHaveProperty('push_token');
  });

  it('checks name and phone in the app first (no secret, no call)', async () => {
    const t = setup(() => ({ data: { request_id: 'r1' }, error: null }));
    expect(await t.run('ع', '07801112222')).toEqual({
      ok: false,
      message: ERROR_MESSAGES.NAME_INVALID,
    });
    expect(await t.run('علي حسين', '0780111')).toEqual({
      ok: false,
      message: ERROR_MESSAGES.PHONE_INVALID,
    });
    expect(t.calls).toEqual([]);
    expect(await readSecret()).toBeNull();
  });

  it.each([
    [409, 'PHONE_TAKEN', ar.register.phoneTaken],
    [409, 'REQUEST_EXISTS', ERROR_MESSAGES.REQUEST_EXISTS],
    [429, 'RATE_LIMITED', ERROR_MESSAGES.RATE_LIMITED],
    [429, 'TOO_MANY_PENDING', ERROR_MESSAGES.TOO_MANY_PENDING],
    [400, 'NAME_INVALID', ERROR_MESSAGES.NAME_INVALID],
    [500, 'REGISTER_FAILED', ERROR_MESSAGES.REGISTER_FAILED],
  ])('HTTP %i %s -> Arabic message, no saved request', async (status, code, message) => {
    const t = setup(() => ({ data: null, error: functionError(status, { error: code }) }));
    expect(await t.run('علي حسين', '07801112222')).toEqual({ ok: false, message });
    expect(await loadRegistration()).toBeNull();
    // السر يبقى: إعادة الإرسال بنفس السر ترجع نفس الطلب إن كان وصل
    expect(await readSecret()).toMatch(B64URL_43);
  });

  it('network failure', async () => {
    const t = setup(() => ({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to fetch' },
    }));
    expect(await t.run('علي حسين', '07801112222')).toEqual({
      ok: false,
      message: NETWORK_ERROR_MESSAGE,
    });
  });

  it('reuses a secret saved by an interrupted attempt', async () => {
    await saveSecret('k'.repeat(43));
    const t = setup(() => ({ data: { request_id: 'r1' }, error: null }));
    await t.run('علي حسين', '07801112222');
    expect((t.calls[0]?.ops[0]?.[1][0] as { device_secret: string }).device_secret).toBe(
      'k'.repeat(43),
    );
  });

  it('never logs the secret', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    const t = setup(() => ({
      data: null,
      error: functionError(500, { error: 'REGISTER_FAILED' }),
    }));
    await t.run('علي حسين', '07801112222');
    const secret = (await readSecret()) as string;
    const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
    expect(logged).not.toContain(secret);
    spies.forEach((s) => s.mockRestore());
  });
});
