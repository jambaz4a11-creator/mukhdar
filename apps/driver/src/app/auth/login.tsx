// الدخول برقم الهاتف + الرمز (SPEC-driver §2.2، ADR 0001). بعد النجاح الحارس يوجّه حسب الملف الشخصي (§2.1).
// notice=ready: الحساب اكتمل سابقاً من هذا الجهاز (حالة completed أو فشل الدخول بعد اختيار الرمز).
import { authError, phonePinCredentials } from '@mukhdar/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { FormMessage, PhoneField, PinField } from '../../components/AuthFields';
import { AuthLayout } from '../../components/AuthLayout';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ShopContact } from '../../components/ShopContact';
import { ROUTES } from '../../features/auth/guard';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, sizes, spacing } from '../../theme';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ notice?: string }>();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const creds = phonePinCredentials(phone, pin);

  async function submit() {
    if (!creds || busy) return;
    const client = getSupabase();
    if (!client) {
      setError(ar.common.notConfigured);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await client.auth.signInWithPassword(creds);
      if (e || !data.session) {
        setError(authError(e).message);
        setBusy(false);
      }
      // نجاح: الجلسة تصل للحارس (onAuthStateChange) فيوجّه للتبويبات أو تغيير الرمز أو "غير مفعّل"
    } catch (e) {
      setError(authError(e).message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout brandHeader>
      <AppText accessibilityRole="header" weight="bold" size="heading">
        {ar.login.title}
      </AppText>
      {params.notice === 'ready' && !error ? (
        <FormMessage tone="info" text={ar.login.accountReady} />
      ) : null}
      <PhoneField value={phone} onChangeText={setPhone} />
      <PinField label={ar.login.pin} value={pin} onChangeText={setPin} testID="pin-input" />
      {error ? <FormMessage text={error} /> : null}
      <PrimaryButton
        title={ar.login.submit}
        onPress={() => void submit()}
        disabled={!creds}
        loading={busy}
        testID="login-submit"
      />
      <View style={styles.switchRow}>
        <AppText muted>{ar.login.newDriver}</AppText>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push(ROUTES.register)}
          style={styles.link}
        >
          <AppText weight="bold" color={colors.primary}>
            {ar.login.registerHere}
          </AppText>
        </Pressable>
      </View>
      <AppText size="small" muted style={styles.center}>
        {ar.login.forgot}
      </AppText>
      <ShopContact phoneInput={phone} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  link: { minHeight: sizes.touchTarget, justifyContent: 'center' },
  center: { textAlign: 'center', marginTop: spacing.xs },
});
