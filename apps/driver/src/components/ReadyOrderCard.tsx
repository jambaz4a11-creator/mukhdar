// بطاقة طلب جاهز (التصميم Main): الرقم، "جاهز من N دقيقة"، شرائح بلوك وبناية، "N منتجات"، الكاش، زر القبول.
// لا اسم ولا هاتف ولا طابق ولا شقة قبل القبول (available_orders لا يرجعها قصداً). `taken`: باهتة "قبله سائق ثاني".
import { formatIQD } from '@mukhdar/shared';
import { StyleSheet, View } from 'react-native';
import { ar } from '../i18n/ar';
import type { AvailableOrder } from '../features/orders/types';
import { minutesSince } from '../features/orders/time';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  order: AvailableOrder;
  taken?: boolean;
  accepting?: boolean;
  onAccept: (id: string) => void;
}

export function ReadyOrderCard({ order, taken = false, accepting = false, onAccept }: Props) {
  const chips = [
    order.subsection.trim() && `بلوك ${order.subsection.trim()}`,
    order.building.trim() && `بناية ${order.building.trim()}`,
  ].filter((c): c is string => Boolean(c));

  return (
    <View style={[styles.card, taken && styles.taken]} testID={`ready-card-${order.id}`}>
      <View style={styles.row}>
        <AppText weight="bold">{`#${order.order_number}`}</AppText>
        {taken ? (
          <AppText weight="semibold" size="small" color="#8A4B0F" testID={`taken-${order.id}`}>
            {ar.orders.takenByOther}
          </AppText>
        ) : (
          <AppText size="small" muted>
            {ar.orders.readyAgo(minutesSince(order.created_at))}
          </AppText>
        )}
      </View>
      <View style={styles.chips}>
        {chips.map((c) => (
          <View key={c} style={styles.chip}>
            <AppText weight="bold">{c}</AppText>
          </View>
        ))}
      </View>
      {taken ? null : (
        <>
          <View style={styles.row}>
            <AppText size="small" muted>
              {ar.orders.productsCount(order.line_count)}
            </AppText>
            <View style={styles.cash}>
              <AppText size="small">{ar.orders.cashToCollect}</AppText>
              <AppText weight="bold" size="title">
                {formatIQD(order.total_iqd)}
              </AppText>
            </View>
          </View>
          <PrimaryButton
            title={ar.orders.accept}
            loading={accepting}
            onPress={() => onAccept(order.id)}
            testID={`accept-${order.id}`}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: spacing.lg,
    gap: spacing.md,
  },
  taken: { opacity: 0.6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: '#F2F4EF' },
  cash: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
});
