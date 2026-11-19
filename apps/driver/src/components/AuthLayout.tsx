// إطار شاشات الدخول (التصميم المعتمد): رأس أخضر اختياري بالشعار ("المخضر" / "تطبيق السائق")، محتوى قابل للتمرير،
// وتذييل ثابت اختياري للزر الرئيسي. لوحة المفاتيح لا تغطي الحقول.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ar } from '../i18n/ar';
import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';

export function AuthLayout({
  brandHeader = false,
  top,
  children,
  footer,
}: {
  /** الرأس الأخضر بالشعار (شاشة الدخول) */
  brandHeader?: boolean;
  /** فوق المحتوى (زر رجوع) */
  top?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={brandHeader ? ['bottom'] : ['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {brandHeader ? (
            <View style={styles.header}>
              <View style={styles.logo}>
                <MaterialCommunityIcons name="truck-outline" size={40} color={colors.primary} />
              </View>
              <AppText weight="bold" size="display" color={colors.surface} style={styles.center}>
                {ar.appName}
              </AppText>
              <AppText color={colors.primarySoft} style={styles.center}>
                {ar.appSubtitle}
              </AppText>
            </View>
          ) : null}
          {top}
          <View style={styles.main}>{children}</View>
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  header: {
    height: 240,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderBottomLeftRadius: radius.card * 2,
    borderBottomRightRadius: radius.card * 2,
  },
  logo: {
    width: 76,
    height: 76,
    borderRadius: radius.card + 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  main: { flex: 1, padding: spacing.screen + 4, paddingTop: 28, gap: spacing.lg + 2 },
  footer: { paddingHorizontal: spacing.screen + 4, paddingTop: spacing.md, paddingBottom: 24 },
});
