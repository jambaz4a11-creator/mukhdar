// "ماكو اتصال" (R1 M2): فشل تجديد الجلسة المحفوظة بسبب الشبكة عند تشغيل التطبيق. الجلسة باقية بالجهاز (لا خروج
// ولا إعادة كتابة الرمز)؛ "إعادة المحاولة" تقرأها من جديد، وتعاد المحاولة تلقائياً عند الرجوع للتطبيق.
// الخروج متاح إن كان العطل ليس شبكة. الحارس يحوّل للتبويبات أو الدخول تلقائياً حين تنجح القراءة.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { AuthLayout } from '../../components/AuthLayout';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { retrySession, signOut } from '../../features/auth/store';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';

export default function OfflineScreen() {
  const [busy, setBusy] = useState(false);

  async function retry() {
    const client = getSupabase();
    if (!client) return;
    setBusy(true);
    try {
      await retrySession(client);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    const client = getSupabase();
    if (client) await signOut(client);
  }

  return (
    <AuthLayout
      footer={
        <View style={styles.footer}>
          <PrimaryButton
            title={ar.offline.retry}
            onPress={() => void retry()}
            loading={busy}
            testID="offline-retry"
          />
          <SecondaryButton
            title={ar.common.signOut}
            onPress={() => void leave()}
            testID="offline-sign-out"
          />
        </View>
      }
    >
      <View style={styles.hero}>
        <View style={styles.icon}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.warningText} />
        </View>
        <AppText accessibilityRole="header" weight="bold" size="heading" style={styles.center}>
          {ar.offline.title}
        </AppText>
        <AppText muted style={styles.center}>
          {ar.offline.body}
        </AppText>
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.lg, paddingTop: 72 },
  icon: {
    width: 96,
    height: 96,
    borderRadius: radius.full,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center', lineHeight: 28 },
  footer: { gap: spacing.sm },
});
