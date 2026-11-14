// الرئيسية (T09): اختبار اتصال بقراءة app_settings من Supabase. الكتالوج بـ T11.
import { errorMessage, formatIQD } from '@mukhdar/shared';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Screen } from '../../components/Screen';
import { useAppSettings } from '../../features/settings/useAppSettings';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, sizes, spacing } from '../../theme';

export default function HomeScreen() {
  return (
    <Screen scroll>
      <View style={styles.header}>
        <AppText weight="bold" size="display" color={colors.primary}>
          {ar.home.title}
        </AppText>
        <AppText muted>{ar.home.subtitle}</AppText>
      </View>
      <StoreStatus />
    </Screen>
  );
}

function StoreStatus() {
  const configured = getSupabase() !== null;
  const settings = useAppSettings();

  if (!configured) {
    return (
      <View style={[styles.banner, { backgroundColor: colors.warningSoft }]}>
        <AppText color={colors.warningText}>{ar.home.notConfigured}</AppText>
      </View>
    );
  }
  if (settings.isPending) {
    return (
      <View style={styles.card} accessibilityLabel={ar.home.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (settings.isError) {
    return (
      <View style={[styles.banner, { backgroundColor: colors.dangerSoft }]}>
        <AppText color={colors.danger}>{errorMessage(settings.error)}</AppText>
        <Pressable
          accessibilityRole="button"
          onPress={() => void settings.refetch()}
          style={styles.retry}
        >
          <AppText weight="semibold" color={colors.primary}>
            {ar.home.retry}
          </AppText>
        </Pressable>
      </View>
    );
  }

  const s = settings.data;
  return (
    <View style={styles.card} testID="store-status">
      <AppText weight="semibold" size="title">
        {ar.home.settingsTitle}
      </AppText>
      <View
        style={[
          styles.chip,
          { backgroundColor: s.store_open ? colors.primarySoft : colors.warningSoft },
        ]}
      >
        <AppText weight="medium" color={s.store_open ? colors.primary : colors.warningText}>
          {s.store_open ? ar.home.storeOpen : (s.closed_message ?? ar.home.storeClosed)}
        </AppText>
      </View>
      <Row label={ar.home.deliveryFee} value={formatIQD(s.delivery_fee_iqd)} />
      <Row
        label={ar.home.minOrder}
        value={s.min_order_iqd > 0 ? formatIQD(s.min_order_iqd) : ar.home.noMinOrder}
      />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText muted>{label}</AppText>
      <AppText weight="semibold">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  banner: { borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  retry: { minHeight: sizes.touchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
});
