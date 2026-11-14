// الدخول برقم الهاتف + PIN (T10، SPEC-customer §2.1). لا OTP ولا أي رسالة.
// redirect: المسار المحمي الذي جاء منه المستخدم (يرجع له بعد الدخول).
import { AUTH_MESSAGES, phonePinCredentials } from '@mukhdar/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet } from 'react-native';
import { AppText } from '../../components/AppText';
import { FormMessage, PhoneField, PinField } from '../../components/AuthFields';
import { AuthLayout, SwitchLink } from '../../components/AuthLayout';
import { PrimaryButton } from '../../components/PrimaryButton';
import { config } from '../../config';
import { forgotPinWhatsappUrl, goAfterAuth, signIn } from '../../features/auth/api';
import { safeRedirect, SIGN_UP } from '../../features/auth/redirect';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, sizes } from '../../theme';

type Params = { redirect?: string; phone?: string; notice?: string };

const NOTICES: Record<string, string> = {
  phone_taken: AUTH_MESSAGES.PHONE_TAKEN,
  created: ar.auth.accountCreated,
};

export default function SignInScreen() {
  const params = useLocalSearchParams<Params>();
  const redirect = safeRedirect(params.redirect);
  const [phone, setPhone] = useState(typeof params.phone === 'string' ? params.phone : '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notice = typeof params.notice === 'string' ? NOTICES[params.notice] : undefined;

  const creds = phonePinCredentials(phone, pin);
  const whatsapp = forgotPinWhatsappUrl(config.shopWhatsapp, phone);

  async function submit() {
    if (!creds || busy) return;
    const client = getSupabase();
    if (!client) {
      setError(ar.home.notConfigured);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await signIn(client, creds);
    if (!result.ok) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    await goAfterAuth(client, result.userId, redirect);
  }

  return (
    <AuthLayout title={ar.auth.signInTitle}>
      {notice && !error ? <FormMessage tone="info" text={notice} /> : null}
      <PhoneField value={phone} onChangeText={setPhone} />
      <PinField label={ar.auth.pin} value={pin} onChangeText={setPin} testID="pin-input" />
      {whatsapp ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(whatsapp)}
          style={styles.forgot}
          testID="forgot-pin"
        >
          <AppText size="small" weight="semibold" color={colors.primary}>
            {ar.auth.forgotPin}
          </AppText>
        </Pressable>
      ) : null}
      {error ? <FormMessage text={error} /> : null}
      <PrimaryButton
        title={ar.auth.signIn}
        onPress={() => void submit()}
        disabled={!creds}
        loading={busy}
        testID="sign-in-submit"
      />
      <SwitchLink
        prompt={ar.auth.noAccount}
        action={ar.auth.createAccount}
        onPress={() => router.replace({ pathname: SIGN_UP, params: { redirect, phone } })}
      />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  forgot: { alignSelf: 'flex-start', minHeight: sizes.touchTarget, justifyContent: 'center' },
});
