// بوابة التثبيت (T37، SPEC-webpush §3.3). ios-browser وunsupported-ios: شاشة كاملة فوق كل شيء (لا تسجيل ولا دخول
// خارج التطبيق المثبَّت على iOS: تخزينه منفصل عن Safari). android-installable: شريط اختياري بأسفل الشاشة.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { ar } from '../../i18n/ar';
import { colors, radius, spacing } from '../../theme';
import { blocksApp, type InstallState } from './installState';
import { useInstallState } from './useInstallState';

interface Props {
  state: InstallState;
  onInstall?: () => void;
  onDismiss?: () => void;
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <AppText weight="bold" style={styles.stepNumberText}>
          {String(n)}
        </AppText>
      </View>
      <AppText style={styles.stepText}>{text}</AppText>
    </View>
  );
}

export function InstallGate({ state, onInstall, onDismiss }: Props) {
  if (blocksApp(state)) {
    const ios = state === 'ios-browser';
    return (
      <SafeAreaView testID="install-gate" style={styles.gate} accessibilityViewIsModal>
        <View style={styles.hero}>
          <View style={styles.icon}>
            <Ionicons
              name={ios ? 'download-outline' : 'phone-portrait-outline'}
              size={44}
              color={colors.primary}
            />
          </View>
          <AppText accessibilityRole="header" weight="bold" size="heading" style={styles.center}>
            {ios ? ar.install.iosTitle : ar.install.unsupportedTitle}
          </AppText>
          <AppText muted style={styles.center}>
            {ios ? ar.install.iosBody : ar.install.unsupportedBody}
          </AppText>
        </View>
        {ios ? (
          <View style={styles.steps}>
            <Step n={1} text={ar.install.iosStep1} />
            <Step n={2} text={ar.install.iosStep2} />
            <Step n={3} text={ar.install.iosStep3} />
            <AppText muted size="small" style={styles.center}>
              {ar.install.iosSafariHint}
            </AppText>
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  if (state === 'android-installable') {
    return (
      <SafeAreaView testID="install-banner" edges={['bottom']} style={styles.bannerWrap}>
        <View style={styles.banner}>
          <AppText style={styles.bannerText}>{ar.install.androidBanner}</AppText>
          <Pressable
            accessibilityRole="button"
            testID="install-banner-install"
            onPress={onInstall}
            style={styles.bannerButton}
          >
            <AppText weight="bold" style={styles.bannerButtonText}>
              {ar.install.androidInstall}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ar.install.androidDismiss}
            testID="install-banner-dismiss"
            onPress={onDismiss}
            hitSlop={12}
          >
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

/** يُركَّب بالجذر: يقرأ الحالة من المتصفح (لا شيء على الأصلي). */
export function InstallGateHost() {
  const { state, promptInstall, dismissBanner } = useInstallState();
  return (
    <InstallGate state={state} onInstall={() => void promptInstall()} onDismiss={dismissBanner} />
  );
}

const styles = StyleSheet.create({
  gate: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.screen,
    gap: spacing.lg,
  },
  hero: { alignItems: 'center', gap: spacing.lg, paddingTop: 72 },
  icon: {
    width: 96,
    height: 96,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center', lineHeight: 28 },
  steps: { gap: spacing.md },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { color: colors.surface },
  stepText: { flex: 1 },
  bannerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 999 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bannerText: { flex: 1 },
  bannerButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerButtonText: { color: colors.surface },
});
