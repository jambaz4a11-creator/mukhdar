// شارة حالة الطلب (التصميم): "بالطريق" أخضر مصمت، "مقبول، بعده بالمحل" و"بانتظار التحضير" كهرماني، النهائية بألوان الحزمة المشتركة.
import { STATUS_COLORS, type OrderStatus } from '@mukhdar/shared';
import { StyleSheet, View } from 'react-native';
import { statusLabel } from '../features/orders/transitions';
import { colors, radius } from '../theme';
import { AppText } from './AppText';

function palette(status: OrderStatus): { text: string; background: string } {
  if (status === 'out_for_delivery') return { text: colors.surface, background: colors.primary };
  if (status === 'ready' || status === 'preparing')
    return { text: '#8A4B0F', background: colors.warningSoft };
  return STATUS_COLORS[status];
}

export function StatusBadge({ status, testID }: { status: OrderStatus; testID?: string }) {
  const p = palette(status);
  return (
    <View style={[styles.badge, { backgroundColor: p.background }]} testID={testID}>
      <AppText weight="bold" size="caption" color={p.text}>
        {statusLabel(status)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
});
