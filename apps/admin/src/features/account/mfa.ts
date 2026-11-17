// المصادقة الثنائية للأدمن والموظف (T23 C1، SPEC-admin §1): TOTP (تطبيق مصادقة)، بلا SMS ولا كلفة.
// - أول دخول بعد التفعيل: تسجيل عامل TOTP (QR + المفتاح اليدوي) ثم أول رمز ← الجلسة aal2.
// - كل دخول بعدها: الـ PIN ثم رمز التطبيق (challengeAndVerify) ← aal2.
// قاعدة البيانات (current_user_role) والدوال الإدارية ترفض الأدمن/الموظف بلا aal2، فهذا للتوجيه فقط.
import { authError, normalizePin, type MukhdarClient } from '@mukhdar/shared';

type MfaClient = Pick<MukhdarClient, 'auth'>;

export const MFA_TEXT = {
  invalidCode: 'رمز التطبيق 6 أرقام',
  wrongCode: 'رمز التطبيق غير صحيح أو انتهى وقته، اكتب الرمز الظاهر الآن',
  noFactor: 'لا يوجد تطبيق مصادقة مسجّل لحسابك، سجّل الخروج وادخل مرة ثانية',
  enrollFailed: 'تعذّر بدء تسجيل تطبيق المصادقة، حاول مرة ثانية',
} as const;

/** اسم العامل والمُصدر كما يظهران بتطبيق المصادقة. */
export const TOTP_ISSUER = 'Mukhdar';
export const TOTP_FRIENDLY_NAME = 'لوحة المخضر';

export type EnrollResult =
  { ok: true; factorId: string; qrCode: string; secret: string } | { ok: false; message: string };

export type VerifyResult = { ok: true } | { ok: false; message: string };

/** الرمز بعد تحويل الأرقام العربية؛ null إن لم يكن 6 أرقام. */
export function normalizeTotpCode(code: string): string | null {
  const c = normalizePin(code.replace(/\s+/g, ''));
  return /^\d{6}$/.test(c) ? c : null;
}

/**
 * يبدأ تسجيل TOTP: يحذف أي محاولة سابقة غير مكتملة (unverified، تمنع نفس الاسم) ثم enroll.
 * GoTrue يسمح بذلك بجلسة aal1 فقط ما دام لا يوجد عامل مُفعَّل.
 */
export async function startTotpEnrollment(client: MfaClient): Promise<EnrollResult> {
  try {
    const listed = await client.auth.mfa.listFactors();
    if (listed.error) return { ok: false, message: authError(listed.error).message };
    for (const f of listed.data.all) {
      if (f.factor_type === 'totp' && f.status === 'unverified') {
        await client.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error } = await client.auth.mfa.enroll({
      factorType: 'totp',
      issuer: TOTP_ISSUER,
      friendlyName: TOTP_FRIENDLY_NAME,
    });
    if (error || !data) return { ok: false, message: MFA_TEXT.enrollFailed };
    return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  } catch (e) {
    return { ok: false, message: authError(e).message };
  }
}

/**
 * يتحقق من رمز التطبيق فترتفع الجلسة لـ aal2. factorId = العامل الجديد أثناء التسجيل، أو null
 * (أول عامل TOTP مُفعَّل للحساب).
 */
export async function verifyTotp(
  client: MfaClient,
  factorId: string | null,
  code: string,
): Promise<VerifyResult> {
  const c = normalizeTotpCode(code);
  if (!c) return { ok: false, message: MFA_TEXT.invalidCode };
  try {
    let id = factorId;
    if (!id) {
      const listed = await client.auth.mfa.listFactors();
      if (listed.error) return { ok: false, message: authError(listed.error).message };
      id = listed.data.totp[0]?.id ?? null;
      if (!id) return { ok: false, message: MFA_TEXT.noFactor };
    }
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId: id, code: c });
    if (error) {
      const errCode = (error as { code?: string }).code;
      if (
        errCode === 'mfa_verification_failed' ||
        errCode === 'mfa_challenge_expired' ||
        errCode === 'mfa_verification_rejected' ||
        (error as { status?: number }).status === 422
      ) {
        return { ok: false, message: MFA_TEXT.wrongCode };
      }
      return { ok: false, message: authError(error).message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: authError(e).message };
  }
}
