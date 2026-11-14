// حساب جديد: الرقم + PIN مرتين (T10). الرمز يُفحص هنا قبل أي طلب شبكة (validatePin)،
// ثم Edge Function signup (التسجيل العام مطفأ، ADR 0001) ثم signInWithPassword بنفس البيانات.
import { PIN_MESSAGES, normalizePin, phonePinCredentials, validatePin } from '@mukhdar/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AppText } from '../../components/AppText';
import { FormMessage, PhoneField, PinField } from '../../components/AuthFields';
import { AuthLayout, SwitchLink } from '../../components/AuthLayout';
import { PrimaryButton } from '../../components/PrimaryButton';
import { createAccount, signIn } from '../../features/auth/api';
import { NAME, safeRedirect, SIGN_IN } from '../../features/auth/redirect';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';

export default function SignUpScreen() {
  const params = useLocalSearchParams<{ redirect?: string; phone?: string }>();
  const redirect = safeRedirect(params.redirect);
  const [phone, setPhone] = useState(typeof params.phone === 'string' ? params.phone : '');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const creds = phonePinCredentials(phone, pin);
  const ready = creds !== null && normalizePin(confirm).length === 6;

  const toSignIn = (extra: Record<string, string> = {}) =>
    router.replace({ pathname: SIGN_IN, params: { redirect, phone, ...extra } });

  async function submit() {
    if (!creds || !ready || busy) return;
    const pinError = validatePin(pin, creds.phone);
    if (pinError) {
      setError(PIN_MESSAGES[pinError]);
      return;
    }
    if (normalizePin(confirm) !== creds.password) {
      setError(ar.auth.pinMismatch);
      return;
    }
    const client = getSupabase();
    if (!client) {
      setError(ar.home.notConfigured);
      return;
    }
    setBusy(true);
    setError(null);
    const created = await createAccount(client, creds);
    if (!created.ok) {
      setBusy(false);
      if (created.error.kind === 'phone_taken') toSignIn({ notice: 'phone_taken' });
      else setError(created.error.message);
      return;
    }
    const session = await signIn(client, creds);
    if (!session.ok) {
      // الحساب موجود والدخول فشل (شبكة مثلاً): نكمل من شاشة الدخول بنفس الرقم (SPEC-customer افتراض 29)
      toSignIn({ notice: 'created' });
      return;
    }
    router.replace({ pathname: NAME, params: { redirect } });
  }

  return (
    <AuthLayout title={ar.auth.signUpTitle}>
      <AppText muted size="small">
        {ar.auth.signUpHint}
      </AppText>
      <PhoneField value={phone} onChangeText={setPhone} />
      <PinField label={ar.auth.pin} value={pin} onChangeText={setPin} testID="pin-input" isNew />
      <PinField
        label={ar.auth.pinConfirm}
        value={confirm}
        onChangeText={setConfirm}
        testID="pin-confirm-input"
        isNew
      />
      {error ? <FormMessage text={error} /> : null}
      <PrimaryButton
        title={ar.auth.signUp}
        onPress={() => void submit()}
        disabled={!ready}
        loading={busy}
        testID="sign-up-submit"
      />
      <SwitchLink
        prompt={ar.auth.haveAccount}
        action={ar.auth.goSignIn}
        onPress={() => toSignIn()}
      />
    </AuthLayout>
  );
}
