import { changePin, PIN_CHANGE_MESSAGES, type PinChangeClient } from '../pinChange';
import { AUTH_MESSAGES } from '../auth-errors';
import { PIN_MESSAGES } from '../pin';

function fakeClient(opts: {
  signIn?: { error: unknown };
  update?: { error: unknown };
  revoke?: { error: unknown };
}) {
  const calls: string[] = [];
  const client: PinChangeClient = {
    auth: {
      signInWithPassword: jest.fn((creds: { phone: string; password: string }) => {
        calls.push(`signIn ${creds.phone} ${creds.password}`);
        return Promise.resolve(opts.signIn ?? { error: null });
      }),
      updateUser: jest.fn((attrs: { password: string }) => {
        calls.push(`update ${attrs.password}`);
        return Promise.resolve(opts.update ?? { error: null });
      }),
      signOut: jest.fn((o: { scope: 'others' }) => {
        calls.push(`signOut ${o.scope}`);
        return Promise.resolve(opts.revoke ?? { error: null });
      }),
    },
  };
  return { client, calls };
}

const PHONE = '9647701234567';

describe('changePin (ADR 0001, shared by customer and driver apps)', () => {
  it('verifies the current PIN, updates with Latin digits, then revokes other sessions', async () => {
    const { client, calls } = fakeClient({});
    expect(await changePin(client, PHONE, '٤٨٢٩١٥', '730514', '٧٣٠٥١٤')).toEqual({ ok: true });
    expect(calls).toEqual(['signIn +9647701234567 482915', 'update 730514', 'signOut others']);
  });

  it('checks the new PIN before any network call', async () => {
    const { client, calls } = fakeClient({});
    expect(await changePin(client, PHONE, '482915', '123456', '123456')).toEqual({
      ok: false,
      field: 'next',
      message: PIN_MESSAGES.PIN_TRIVIAL,
    });
    expect(await changePin(client, PHONE, '482915', '730514', '730515')).toMatchObject({
      message: PIN_CHANGE_MESSAGES.mismatch,
    });
    expect(await changePin(client, PHONE, '730514', '730514', '730514')).toMatchObject({
      message: PIN_CHANGE_MESSAGES.same,
    });
    expect(calls).toEqual([]);
  });

  it('wrong current PIN is reported on the current field', async () => {
    const { client } = fakeClient({ signIn: { error: { code: 'invalid_credentials' } } });
    expect(await changePin(client, PHONE, '482915', '730514', '730514')).toEqual({
      ok: false,
      field: 'current',
      message: PIN_CHANGE_MESSAGES.wrongCurrent,
    });
  });

  it('rate limit on sign-in keeps the auth message', async () => {
    const { client } = fakeClient({ signIn: { error: { status: 429 } } });
    expect(await changePin(client, PHONE, '482915', '730514', '730514')).toMatchObject({
      field: 'current',
      message: AUTH_MESSAGES.RATE_LIMITED,
    });
  });

  it('same_password from GoTrue maps to the "same" message', async () => {
    const { client } = fakeClient({ update: { error: { code: 'same_password' } } });
    expect(await changePin(client, PHONE, '482915', '730514', '730514')).toMatchObject({
      field: 'next',
      message: PIN_CHANGE_MESSAGES.same,
    });
  });

  it('a failed revoke does not undo the change; it is reported to the callback', async () => {
    const onRevokeError = jest.fn();
    const { client } = fakeClient({ revoke: { error: new Error('x') } });
    expect(await changePin(client, PHONE, '482915', '730514', '730514', { onRevokeError })).toEqual(
      { ok: true },
    );
    expect(onRevokeError).toHaveBeenCalledTimes(1);
  });

  it('an unusable phone fails without calling the server', async () => {
    const { client, calls } = fakeClient({});
    expect(await changePin(client, '', '482915', '730514', '730514')).toMatchObject({
      field: 'current',
      message: PIN_CHANGE_MESSAGES.failed,
    });
    expect(calls).toEqual([]);
  });
});
