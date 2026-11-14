// حسابي: محمية (T10). الآن: الرقم وتسجيل الخروج فقط؛ بقية الشاشة (الاسم، العناوين، حذف الحساب) بـ T15.
// تسجيل الخروج يمسح الجلسة (secure-store) والسلة تبقى.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../../components/AppText';
import { Placeholder } from '../../components/Screen';
import { displayPhone } from '../../features/auth/api';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { ar } from '../../i18n/ar';
import { captureError, isSentryEnabled } from '../../lib/sentry';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, sizes, spacing } from '../../theme';

export default function AccountScreen() {
  const session = useRequireAuth();
  const [sent, setSent] = useState(false);
  if (!session) return null;

  async function signOut() {
    try {
      await getSupabase()?.auth.signOut();
    } catch (e) {
      captureError(e);
    }
    router.replace('/');
  }

  return (
    <Placeholder>
      <AppText weight="semibold" size="title">
        {displayPhone(session.user.phone)}
      </AppText>
      <AppText muted>{ar.placeholders.soon}</AppText>
      <Pressable
        accessibilityRole="button"
        style={[styles.button, styles.signOut]}
        onPress={() => void signOut()}
        testID="sign-out"
      >
        <AppText weight="medium" color={colors.danger}>
          {ar.auth.signOut}
        </AppText>
      </Pressable>
      {/* اختبار T09 اليدوي: خطأ متعمد يصل لـ Sentry. يظهر فقط بالتطوير ومع DSN مضبوط. */}
      {__DEV__ && isSentryEnabled() ? (
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            captureError(new Error('Sentry test error (T09, manual)'));
            setSent(true);
          }}
        >
          <AppText weight="medium" color={colors.danger}>
            {sent ? ar.dev.sentrySent : ar.dev.sentryTest}
          </AppText>
        </Pressable>
      ) : null}
    </Placeholder>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: sizes.touchTarget,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: colors.dangerSoft,
  },
  signOut: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
