// عمليات الدخول والتسجيل (T10، ADR 0001). لا signInWithOtp ولا verifyOtp ولا auth.signUp:
// التسجيل العام مطفأ، والحساب الجديد من Edge Function signup ثم signInWithPassword.
import {
  authError,
  normalizeIraqiPhone,
  parseFunctionError,
  type AuthError,
  type MukhdarClient,
  type PhonePinCredentials,
} from '@mukhdar/shared';
import { router } from 'expo-router';
import { NAME } from './redirect';

export type Outcome = { ok: true; userId: string } | { ok: false; error: AuthError };

export async function signIn(client: MukhdarClient, creds: PhonePinCredentials): Promise<Outcome> {
  try {
    const { data, error } = await client.auth.signInWithPassword(creds);
    if (error || !data.session) return { ok: false, error: authError(error) };
    return { ok: true, userId: data.session.user.id };
  } catch (e) {
    return { ok: false, error: authError(e) };
  }
}

/** ينشئ الحساب عبر الدالة (لا جلسة). */
export async function createAccount(
  client: MukhdarClient,
  creds: PhonePinCredentials,
): Promise<{ ok: true } | { ok: false; error: AuthError }> {
  try {
    const { error } = await client.functions.invoke('signup', {
      body: { phone: creds.phone, pin: creds.password },
    });
    if (error) return { ok: false, error: authError(await parseFunctionError(error)) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: authError(e) };
  }
}

/** profiles.full_name، أو null إن كان فارغاً أو تعذّرت القراءة. */
export async function fetchFullName(client: MukhdarClient, userId: string): Promise<string | null> {
  const { data, error } = await client
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const name = (data as { full_name: string | null } | null)?.full_name?.trim();
  return name ? name : null;
}

/** بعد الدخول: الاسم فارغ ← شاشة الاسم، وإلا الرجوع لمكان المستخدم. */
export async function goAfterAuth(
  client: MukhdarClient,
  userId: string,
  redirect: string,
): Promise<void> {
  let name: string | null = 'unknown';
  try {
    name = await fetchFullName(client, userId);
  } catch {
    // تعذّرت القراءة: لا نوقف المستخدم؛ الاسم يُطلب لاحقاً من "حسابي"
  }
  if (name === null) router.replace({ pathname: NAME, params: { redirect } });
  else router.replace(redirect);
}

/** "نسيت الرمز؟": رابط wa.me برسالة جاهزة فيها رقم الزبون. null إن لم يُضبط رقم المتجر. */
export function forgotPinWhatsappUrl(shopNumber: string, phoneInput: string): string | null {
  const shop = shopNumber.replace(/[\s+\-()]/g, '');
  if (!/^\d{8,15}$/.test(shop)) return null;
  const e164 = normalizeIraqiPhone(phoneInput);
  const text = e164 ? `نسيت رمز الدخول، رقمي 0${e164.slice(4)}` : 'نسيت رمز الدخول';
  return `https://wa.me/${shop}?text=${encodeURIComponent(text)}`;
}

/** 9647701234567 / +9647701234567 ← 07701234567 للعرض. */
export function displayPhone(stored: string | null | undefined): string {
  const e164 = stored ? normalizeIraqiPhone(stored) : null;
  return e164 ? `0${e164.slice(4)}` : '';
}
