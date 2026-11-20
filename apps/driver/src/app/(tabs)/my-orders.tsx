// طلباتي (SPEC-driver §2.7، التصميم MyOrders): المعيَّنة لي وغير النهائية. Realtime بفلتر driver_id=eq.<me> + إعادة جلب
// كل 30 ثانية وعند الرجوع (النقل لسائق آخر لا يصل بـ Realtime). طلب يختفي أو يصير cancelled يُزال برسالة قصيرة.
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { MyOrderCard } from '../../components/MyOrderCard';
import { useAuth } from '../../features/auth/store';
import { fetchMyOrders, removedOrders, subscribeMyOrders } from '../../features/orders/mine';
import type { MyOrder } from '../../features/orders/types';
import { useNotificationRefresh } from '../../features/notifications/events';
import { useFocusedPoll } from '../../features/orders/useFocusedPoll';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';

export default function MyOrdersScreen() {
  const userId = useAuth((s) => s.session?.user.id ?? null);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const previous = useRef<MyOrder[]>([]);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client || !userId || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await fetchMyOrders(client, userId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      const first = removedOrders(previous.current, result.orders)[0];
      if (first) {
        const number = previous.current.find((o) => o.id === first.id)?.order_number ?? 0;
        setNotice(
          first.reason === 'cancelled'
            ? ar.orders.removedCancelled(number)
            : ar.orders.removedGone(number),
        );
      }
      // طلب ملغى لا يظهر بالقائمة (الاستعلام يستثني النهائية؛ هذا احتياط لو رجع بحالة cancelled)
      const visible = result.orders.filter((o) => o.status !== 'cancelled');
      previous.current = result.orders;
      setOrders(visible);
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [userId]);

  useFocusedPoll(load);
  // إشعار نقل/إلغاء/تعيين والتطبيق مفتوح: النقل لا يصل بـ Realtime فالإشعار هو السريع
  useNotificationRefresh(null, () => void load());

  useEffect(() => {
    const client = getSupabase();
    if (!client || !userId) return undefined;
    return subscribeMyOrders(client, userId, () => void load());
  }, [userId, load]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <AppText accessibilityRole="header" weight="bold" size="heading">
          {ar.orders.mineTitle}
        </AppText>
        <AppText size="small" muted>
          {ar.orders.mineSubtitle}
        </AppText>
      </View>

      {notice ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setNotice(null)}
          style={styles.notice}
          testID="mine-notice"
        >
          <AppText size="small" color={colors.warningText}>
            {notice}
          </AppText>
        </Pressable>
      ) : null}
      {error ? (
        <View style={styles.error} testID="mine-error">
          <AppText size="small" color={colors.danger}>
            {error}
          </AppText>
        </View>
      ) : null}

      <FlatList
        testID="mine-list"
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        renderItem={({ item }) => (
          <MyOrderCard order={item} onPress={(id) => router.push(`/order/${id}`)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListEmptyComponent={
          loaded && !error ? (
            <View style={styles.empty}>
              <AppText muted style={styles.center}>
                {ar.orders.mineEmpty}
              </AppText>
            </View>
          ) : undefined
        }
        ListFooterComponent={
          orders.length > 0 ? (
            <AppText size="small" muted style={[styles.center, styles.hint]}>
              {ar.orders.mineHint}
            </AppText>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.screen, paddingTop: 18, paddingBottom: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, flexGrow: 1 },
  gap: { height: spacing.md },
  notice: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.warningSoft,
  },
  error: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.dangerSoft,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screen },
  center: { textAlign: 'center' },
  hint: { marginTop: spacing.xs },
});
