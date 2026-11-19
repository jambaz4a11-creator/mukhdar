// عمليات الدخول والتسجيل (T10، ADR 0001). لا signInWithOtp ولا verifyOtp ولا auth.signUp:
// التسجيل العام مطفأ، والحساب الجديد من Edge Function signup ثم signInWithPassword.
import {
  authError,
  parseFunctionError,
  type AuthError,
  type MukhdarClient,
  type PhonePinCredentials,
} from '@mukhdar/shared';
import { router } from 'expo-router';
import { CHANGE_PIN, NAME } from './redirect';
import { useAuth } from './store';

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

/** الاسم وعلامة الرمز المؤقت (profiles.must_change_pin) بعد الدخول. */
export async function fetchSignInProfile(
  client: MukhdarClient,
  userId: string,
): Promise<{ name: string | null; mustChangePin: boolean }> {
  const { data, error } = await client
    .from('profiles')
    .select('full_name, must_change_pin')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { full_name: string | null; must_change_pin?: boolean } | null;
  const name = row?.full_name?.trim();
  return { name: name ? name : null, mustChangePin: row?.must_change_pin === true };
}

/**
 * بعد الدخول: رمز مؤقت (أعاد المتجر ضبطه) ← تغيير الرمز إجبارياً أولاً (الخادم يرفض الطلبات حتى يُغيَّر)؛
 * ثم الاسم فارغ ← شاشة الاسم؛ وإلا الرجوع لمكان المستخدم.
 */
export async function goAfterAuth(
  client: MukhdarClient,
  userId: string,
  redirect: string,
): Promise<void> {
  let profile: { name: string | null; mustChangePin: boolean } = {
    name: 'unknown',
    mustChangePin: false,
  };
  try {
    profile = await fetchSignInProfile(client, userId);
    // القراءة نجحت فقط: عند الفشل لا نمسح علامة معروفة
    useAuth.setState({ mustChangePin: profile.mustChangePin });
  } catch {
    // تعذّرت القراءة: لا نوقف المستخدم؛ الاسم يُطلب لاحقاً من "حسابي"، والخادم يرفض الطلب برمز مؤقت
  }
  if (profile.mustChangePin) {
    router.replace({ pathname: CHANGE_PIN, params: { forced: '1', redirect } });
  } else if (profile.name === null) router.replace({ pathname: NAME, params: { redirect } });
  else router.replace(redirect);
}

// forgotPinWhatsappUrl وdisplayPhone من @mukhdar/shared (T30: مشتركة مع تطبيق السائق)
export { displayPhone, forgotPinWhatsappUrl } from '@mukhdar/shared';
