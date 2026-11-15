// شاشة الطلب (T13: مؤقتة بعد التأكيد). تعرض رقم الطلب والمجموع **الراجع من place_order** (لا المحسوب محلياً).
// التتبع الكامل (الخط الزمني، Realtime، الإلغاء، التقييم) بـ T14.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatIQD } from '@mukhdar/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Screen } from '../../components/Screen';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { ar } from '../../i18n/ar';
import { colors, radius, sizes, spacing } from '../../theme';

type Params = { id: string; number?: string; total?: string };

export default function OrderScreen() {
  const session = useRequireAuth();
  const params = useLocalSearchParams<Params>();
  if (!session) return null;
  const total = params.total && /^\d+$/.test(params.total) ? Number(params.total) : null;

  return (
    <Screen>
      <View style={styles.center}>
        <View style={styles.icon}>
          <Ionicons name="checkmark" size={40} color={colors.primary} />
        </View>
        <AppText accessibilityRole="header" weight="bold" size="heading" style={styles.text}>
          {params.number ? ar.order.received(params.number) : ar.order.receivedNoNumber}
        </AppText>
        {total !== null ? (
          <View style={styles.total}>
            <AppText muted>{ar.order.total}</AppText>
            <AppText weight="bold" size="display" testID="order-total">
              {formatIQD(total)}
            </AppText>
          </View>
        ) : null}
        <AppText muted style={styles.text}>
          {ar.order.cashHint}
        </AppText>
        <AppText muted size="small" style={styles.text}>
          {ar.order.trackingSoon}
        </AppText>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/')}
          style={styles.home}
          testID="order-home"
        >
          <AppText weight="semibold" color={colors.primary}>
            {ar.order.home}
          </AppText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  icon: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { textAlign: 'center' },
  total: { alignItems: 'center', gap: 2 },
  home: { minHeight: sizes.touchTarget, justifyContent: 'center', marginTop: spacing.lg },
});
