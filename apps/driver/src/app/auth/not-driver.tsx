// "حسابك غير مفعّل كسائق" (SPEC-driver §2.1، DRIVER-API §2.3): دور غير driver أو حساب معطّل. "تحديث" يعيد قراءة
// الملف الشخصي (الأدمن فعّله الآن ← الحارس يفتح التبويبات)، و"تسجيل الخروج". لا تُستدعى دوال السائق.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { AuthLayout } from '../../components/AuthLayout';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { ShopContact } from '../../components/ShopContact';
import { refreshProfile, signOut } from '../../features/auth/store';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';

export default function NotDriverScreen() {
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const client = getSupabase();
    if (!client) return;
    setBusy(true);
    await refreshProfile(client);
    setBusy(false);
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
            title={ar.notDriver.refresh}
            onPress={() => void refresh()}
            loading={busy}
            testID="not-driver-refresh"
          />
          <SecondaryButton
            title={ar.common.signOut}
            onPress={() => void leave()}
            testID="not-driver-sign-out"
          />
        </View>
      }
    >
      <View style={styles.hero}>
        <View style={styles.icon}>
          <Ionicons name="lock-closed-outline" size={44} color={colors.warningText} />
        </View>
        <AppText accessibilityRole="header" weight="bold" size="heading" style={styles.center}>
          {ar.notDriver.title}
        </AppText>
        <AppText muted style={styles.center}>
          {ar.notDriver.body}
        </AppText>
      </View>
      <ShopContact />
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
