// بطاقة طلبي (التصميم MyOrders): الرقم والشارة، العنوان الكامل بـ formatAddress، الاسم، الكاش.
// "بالطريق" بحد أخضر 2px. زبون محذوف ← "حساب محذوف".
import { formatAddress, formatIQD } from '@mukhdar/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { isDeletedCustomerSnapshot } from '../features/orders/address';
import type { MyOrder } from '../features/orders/types';
import { ar } from '../i18n/ar';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';
import { StatusBadge } from './StatusBadge';

function addressLine(order: MyOrder): string {
  const s = order.address_snapshot ?? {};
  return formatAddress({
    sector: s.sector ?? '',
    subsection: s.subsection ?? '',
    building: s.building ?? '',
    apartment: s.apartment ?? undefined,
    floor: s.floor ?? undefined,
  });
}

export function MyOrderCard({ order, onPress }: { order: MyOrder; onPress: (id: string) => void }) {
  const onTheWay = order.status === 'out_for_delivery';
  const deleted = isDeletedCustomerSnapshot(order.address_snapshot, order.customer_name);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(order.id)}
      testID={`mine-card-${order.id}`}
      style={[styles.card, onTheWay && styles.active]}
    >
      <View style={styles.row}>
        <AppText weight="bold">{`#${order.order_number}`}</AppText>
        <StatusBadge status={order.status} />
      </View>
      <AppText weight="bold" size="title">
        {addressLine(order)}
      </AppText>
      <View style={styles.row}>
        <AppText size="small" muted>
          {deleted ? ar.orders.deletedCustomer : (order.customer_name ?? '')}
        </AppText>
        <View style={styles.cash}>
          <AppText size="small">{ar.orders.cashShort}</AppText>
          <AppText weight="bold" size="small">
            {formatIQD(order.total_iqd)}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  active: { borderWidth: 2, borderColor: colors.primary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cash: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
});
