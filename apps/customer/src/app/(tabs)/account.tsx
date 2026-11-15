// حسابي: محمية (T10). الآن: الرقم، عناويني (T12)، وتسجيل الخروج؛ بقية الشاشة (الاسم، حذف الحساب) بـ T15.
// تسجيل الخروج يحذف رمز إشعارات الجهاز (T14) ثم يمسح الجلسة (secure-store)، والسلة تبقى.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../../components/AppText';
import { Placeholder } from '../../components/Screen';
import { useMyAddresses } from '../../features/addresses/hooks';
import { displayPhone } from '../../features/auth/api';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { unregisterPushToken } from '../../features/notifications/push';
import { ar } from '../../i18n/ar';
import { captureError, isSentryEnabled } from '../../lib/sentry';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, sizes, spacing } from '../../theme';

export default function AccountScreen() {
  const session = useRequireAuth();
  const [sent, setSent] = useState(false);
  const addresses = useMyAddresses();
  if (!session) return null;

  async function signOut() {
    const client = getSupabase();
    try {
      // رمز الإشعارات أولاً (يحتاج الجلسة، RLS)، ثم إنهاء الجلسة
      if (client) await unregisterPushToken(client);
      await client?.auth.signOut();
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
      <Pressable
        accessibilityRole="button"
        style={styles.row}
        onPress={() => router.push('/address')}
        testID="my-addresses"
      >
        <Ionicons name="location-outline" size={20} color={colors.primary} />
        <AppText style={styles.rowText}>{ar.address.listTitle}</AppText>
        {addresses.data ? <AppText muted>{addresses.data.length}</AppText> : null}
        <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
      </Pressable>
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
  row: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1 },
  signOut: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
