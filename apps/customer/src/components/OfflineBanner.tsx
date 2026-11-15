// شريط "بدون إنترنت" أعلى التطبيق (مراجعة S4). بالجذر، فوق التنقل: SafeAreaView الشاشات تحته لا تضيف
// مسافة الشريط العلوي مرة ثانية لأنها لم تعد تحت شريط الحالة.
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ar } from '../i18n/ar';
import { useIsOnline } from '../lib/network';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';

export function OfflineBanner() {
  const online = useIsOnline();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + spacing.sm }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="offline-banner"
    >
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warningText} />
      <AppText size="small" weight="medium" color={colors.warningText}>
        {ar.offline.banner}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.warningSoft,
  },
});
