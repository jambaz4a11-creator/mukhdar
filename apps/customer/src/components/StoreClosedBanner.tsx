// شريط "المتجر مغلق" (app_settings.store_open = false) بنص closed_message. التصفح والسلة مسموحان، والطلب ممنوع (T13).
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { useAppSettings } from '../features/settings/useAppSettings';
import { ar } from '../i18n/ar';
import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';

export function StoreClosedBanner() {
  const settings = useAppSettings();
  if (!settings.data || settings.data.store_open) return null;
  const message = settings.data.closed_message?.trim() || ar.home.storeClosed;

  return (
    <View
      style={styles.banner}
      testID="store-closed-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="time-outline" size={20} color={colors.warningText} />
      <AppText size="small" color={colors.warningText} style={styles.text}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: spacing.screen,
    marginBottom: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.warningSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  text: { flex: 1 },
});
