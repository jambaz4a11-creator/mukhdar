// شارة حالة الطلب: الاسم والألوان من @mukhdar/shared (STATUS_LABELS / STATUS_COLORS)، نفس اللوحة والسائق.
import { STATUS_COLORS, STATUS_LABELS, type OrderStatus } from '@mukhdar/shared';
import { StyleSheet, View } from 'react-native';
import { radius } from '../theme';
import { AppText } from './AppText';

export function StatusBadge({ status, testID }: { status: OrderStatus; testID?: string }) {
  const c = STATUS_COLORS[status];
  return (
    <View style={[styles.badge, { backgroundColor: c.background }]} testID={testID}>
      <AppText size="caption" weight="semibold" color={c.text}>
        {STATUS_LABELS[status]}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
});
