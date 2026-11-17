import { describe, expect, it, vi } from 'vitest';
import { roleErrorText } from '@/features/admin/StaffScreen';
import { CHANGE_PIN_TEXT, changePanelPin } from './changePin';
import { MFA_TEXT } from './mfa';

const PHONE = '9647701234567';

function fakeClient(
  opts: { signIn?: unknown; update?: unknown; others?: unknown; verify?: unknown } = {},
) {
  const mfa = {
    listFactors: vi.fn().mockResolvedValue({
      data: { all: [], totp: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] },
      error: null,
    }),
    challengeAndVerify: vi.fn().mockResolvedValue({ error: opts.verify ?? null }),
  };
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ error: opts.signIn ?? null }),
    updateUser: vi.fn().mockResolvedValue({ error: opts.update ?? null }),
    signOut: vi.fn().mockResolvedValue({ error: opts.others ?? null }),
    mfa,
  };
  return { client: { auth } as never, auth };
}
const CODE = '123456'; // رمز تطبيق المصادقة

describe('changePanelPin (ADR 0001 flow)', () => {
  it('signs in with the current PIN, verifies the TOTP code (aal2), updates, then signs other devices out', async () => {
    const { client, auth } = fakeClient();
    const r = await changePanelPin(client, PHONE, '482915', '١٢٣٤٥٦', '٥٨٣٩٢٦', '583926');
    expect(r).toEqual({ ok: true, othersSignedOut: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647701234567',
      password: '482915',
    });
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: CODE });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: '583926' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
      fn.mock.invocationCallOrder[0];
    expect(order(auth.signInWithPassword)).toBeLessThan(order(auth.mfa.challengeAndVerify));
    expect(order(auth.mfa.challengeAndVerify)).toBeLessThan(order(auth.updateUser));
  });

  it('T23 C1: a missing or wrong TOTP code → totp field, the PIN is not changed', async () => {
    const { client, auth } = fakeClient();
    expect(await changePanelPin(client, PHONE, '482915', '12', '583926', '583926')).toMatchObject({
      ok: false,
      field: 'totp',
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    const wrong = fakeClient({ verify: { code: 'mfa_verification_failed', status: 422 } });
    expect(
      await changePanelPin(wrong.client, PHONE, '482915', CODE, '583926', '583926'),
    ).toMatchObject({ ok: false, field: 'totp', message: MFA_TEXT.wrongCode });
    expect(wrong.auth.updateUser).not.toHaveBeenCalled();
  });

  it('rejects before any call: easy PIN, mismatch, same as current, no phone', async () => {
    const { client, auth } = fakeClient();
    expect((await changePanelPin(client, PHONE, '482915', CODE, '123456', '123456')).ok).toBe(
      false,
    );
    expect(await changePanelPin(client, PHONE, '482915', CODE, '583926', '583927')).toMatchObject({
      field: 'next',
      message: CHANGE_PIN_TEXT.mismatch,
    });
    expect(await changePanelPin(client, PHONE, '482915', CODE, '482915', '482915')).toMatchObject({
      message: CHANGE_PIN_TEXT.same,
    });
    expect(await changePanelPin(client, null, '482915', CODE, '583926', '583926')).toMatchObject({
      field: 'current',
      message: CHANGE_PIN_TEXT.noPhone,
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('wrong current PIN → current field, no update', async () => {
    const { client, auth } = fakeClient({
      signIn: { code: 'invalid_credentials', status: 400 },
    });
    expect(await changePanelPin(client, PHONE, '111222', CODE, '583926', '583926')).toMatchObject({
      ok: false,
      field: 'current',
      message: CHANGE_PIN_TEXT.wrongCurrent,
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('signing other devices out failing does not undo the change', async () => {
    const { client } = fakeClient({ others: { message: 'x' } });
    expect(await changePanelPin(client, PHONE, '482915', CODE, '583926', '583926')).toEqual({
      ok: true,
      othersSignedOut: false,
    });
  });
});

describe('roleErrorText', () => {
  it('a driver holding orders: message + order numbers', () => {
    expect(roleErrorText({ message: 'DRIVER_HAS_ORDERS', details: '#12، #15' })).toBe(
      'السائق عنده طلبات لم تنتهِ: انقلها لسائق آخر أو أكملها أولاً. الطلبات: #12، #15',
    );
    expect(roleErrorText({ message: 'CANNOT_DEMOTE_SELF' })).toContain('بنفسك');
  });
});
