import { describe, expect, it, vi } from 'vitest';
import { roleErrorText } from '@/features/admin/StaffScreen';
import { CHANGE_PIN_TEXT, changePanelPin } from './changePin';

const PHONE = '9647701234567';

function fakeClient(opts: { signIn?: unknown; update?: unknown; others?: unknown } = {}) {
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ error: opts.signIn ?? null }),
    updateUser: vi.fn().mockResolvedValue({ error: opts.update ?? null }),
    signOut: vi.fn().mockResolvedValue({ error: opts.others ?? null }),
  };
  return { client: { auth } as never, auth };
}

describe('changePanelPin (ADR 0001 flow)', () => {
  it('signs in with the current PIN, updates, then signs other devices out', async () => {
    const { client, auth } = fakeClient();
    const r = await changePanelPin(client, PHONE, '482915', '٥٨٣٩٢٦', '583926');
    expect(r).toEqual({ ok: true, othersSignedOut: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647701234567',
      password: '482915',
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: '583926' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('rejects before any call: easy PIN, mismatch, same as current, no phone', async () => {
    const { client, auth } = fakeClient();
    expect((await changePanelPin(client, PHONE, '482915', '123456', '123456')).ok).toBe(false);
    expect(await changePanelPin(client, PHONE, '482915', '583926', '583927')).toMatchObject({
      field: 'next',
      message: CHANGE_PIN_TEXT.mismatch,
    });
    expect(await changePanelPin(client, PHONE, '482915', '482915', '482915')).toMatchObject({
      message: CHANGE_PIN_TEXT.same,
    });
    expect(await changePanelPin(client, null, '482915', '583926', '583926')).toMatchObject({
      field: 'current',
      message: CHANGE_PIN_TEXT.noPhone,
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('wrong current PIN → current field, no update', async () => {
    const { client, auth } = fakeClient({
      signIn: { code: 'invalid_credentials', status: 400 },
    });
    expect(await changePanelPin(client, PHONE, '111222', '583926', '583926')).toMatchObject({
      ok: false,
      field: 'current',
      message: CHANGE_PIN_TEXT.wrongCurrent,
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('signing other devices out failing does not undo the change', async () => {
    const { client } = fakeClient({ others: { message: 'x' } });
    expect(await changePanelPin(client, PHONE, '482915', '583926', '583926')).toEqual({
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
