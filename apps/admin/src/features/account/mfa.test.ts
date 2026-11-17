import { describe, expect, it, vi } from 'vitest';
import { hasVerifiedTotp } from '@/lib/panelUser';
import { MFA_TEXT, normalizeTotpCode, startTotpEnrollment, verifyTotp } from './mfa';

function fakeClient(
  opts: {
    all?: { id: string; factor_type: string; status: string }[];
    totp?: { id: string }[];
    enroll?: { data: unknown; error: unknown };
    verify?: unknown;
  } = {},
) {
  const mfa = {
    listFactors: vi
      .fn()
      .mockResolvedValue({ data: { all: opts.all ?? [], totp: opts.totp ?? [] }, error: null }),
    unenroll: vi.fn().mockResolvedValue({ error: null }),
    enroll: vi.fn().mockResolvedValue(
      opts.enroll ?? {
        data: { id: 'new', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABC' } },
        error: null,
      },
    ),
    challengeAndVerify: vi.fn().mockResolvedValue({ error: opts.verify ?? null }),
  };
  return { client: { auth: { mfa } } as never, mfa };
}

describe('TOTP (T23 C1)', () => {
  it('normalizes Arabic digits and spaces, rejects anything but 6 digits', () => {
    expect(normalizeTotpCode('١٢٣ ٤٥٦')).toBe('123456');
    expect(normalizeTotpCode('12345')).toBeNull();
    expect(normalizeTotpCode('12345a')).toBeNull();
  });

  it('enrollment drops an unfinished attempt, then returns the QR and manual key', async () => {
    const { client, mfa } = fakeClient({
      all: [
        { id: 'old', factor_type: 'totp', status: 'unverified' },
        { id: 'ok', factor_type: 'totp', status: 'verified' },
      ],
    });
    expect(await startTotpEnrollment(client)).toEqual({
      ok: true,
      factorId: 'new',
      qrCode: 'data:image/svg+xml;utf-8,<svg/>',
      secret: 'ABC',
    });
    expect(mfa.unenroll).toHaveBeenCalledTimes(1);
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old' });
    expect(mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }));
  });

  it('enrollment failure → readable message', async () => {
    const { client } = fakeClient({ enroll: { data: null, error: { message: 'x' } } });
    expect(await startTotpEnrollment(client)).toEqual({
      ok: false,
      message: MFA_TEXT.enrollFailed,
    });
  });

  it('verify uses the enrolling factor, or the first verified TOTP factor', async () => {
    const a = fakeClient();
    expect(await verifyTotp(a.client, 'new', '123456')).toEqual({ ok: true });
    expect(a.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'new', code: '123456' });
    expect(a.mfa.listFactors).not.toHaveBeenCalled();

    const b = fakeClient({ totp: [{ id: 'f9' }] });
    expect(await verifyTotp(b.client, null, '654321')).toEqual({ ok: true });
    expect(b.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f9', code: '654321' });
  });

  it('wrong code, no factor, bad input', async () => {
    const wrong = fakeClient({ verify: { code: 'mfa_verification_failed', status: 422 } });
    expect(await verifyTotp(wrong.client, 'new', '000000')).toEqual({
      ok: false,
      message: MFA_TEXT.wrongCode,
    });
    const none = fakeClient();
    expect(await verifyTotp(none.client, null, '000000')).toEqual({
      ok: false,
      message: MFA_TEXT.noFactor,
    });
    expect(await verifyTotp(none.client, null, '12')).toEqual({
      ok: false,
      message: MFA_TEXT.invalidCode,
    });
    expect(none.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('hasVerifiedTotp: only a verified TOTP factor counts', () => {
    expect(hasVerifiedTotp({ factors: [{ factor_type: 'totp', status: 'verified' }] })).toBe(true);
    expect(hasVerifiedTotp({ factors: [{ factor_type: 'totp', status: 'unverified' }] })).toBe(
      false,
    );
    expect(hasVerifiedTotp({ factors: [{ factor_type: 'phone', status: 'verified' }] })).toBe(
      false,
    );
    expect(hasVerifiedTotp({})).toBe(false);
  });
});
