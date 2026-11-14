// إطار شاشتي الدخول والتسجيل حسب التصميم: رأس أخضر بالشعار والاسم، ثم النموذج، و"تصفح بدون تسجيل" بالأسفل.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ar } from '../i18n/ar';
import { colors, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.logo}>
              <Ionicons name="leaf-outline" size={42} color={colors.primary} />
            </View>
            <AppText weight="bold" size="display" color={colors.surface} style={styles.center}>
              {ar.appName}
            </AppText>
            <AppText color={colors.primarySoft} style={styles.center}>
              {ar.auth.tagline}
            </AppText>
          </View>

          <View style={styles.main}>
            <AppText accessibilityRole="header" weight="bold" size="heading">
              {title}
            </AppText>
            {children}
          </View>

          <Pressable
            accessibilityRole="link"
            onPress={() => router.replace('/')}
            style={styles.browse}
          >
            <AppText size="small" muted style={styles.center}>
              {ar.auth.browse}
            </AppText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** "ما عندك حساب؟ سوّي حساب جديد" وأمثالها. */
export function SwitchLink({
  prompt,
  action,
  onPress,
}: {
  prompt: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.switchRow}>
      <AppText muted>{prompt}</AppText>
      <Pressable accessibilityRole="link" onPress={onPress} style={styles.switchLink}>
        <AppText weight="bold" color={colors.primary}>
          {action}
        </AppText>
      </Pressable>
    </View>
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
  main: { flex: 1, padding: spacing.screen, paddingTop: 28, gap: spacing.lg + 2 },
  browse: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  switchLink: { minHeight: sizes.touchTarget, justifyContent: 'center' },
});
