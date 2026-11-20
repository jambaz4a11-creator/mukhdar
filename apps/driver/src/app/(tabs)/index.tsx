// الطلبات الجاهزة (SPEC-driver §2.6، التصميم Main). available_orders(20)؛ تحديث بالسحب وكل 30 ثانية والشاشة ظاهرة
// وعند الرجوع للتطبيق. القبول ذرّي بالخادم: الخسارة ← "قبله سائق ثاني" ثم تُحذف بالتحديث التالي. NOT_ALLOWED ← فحص الحارس.
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { ReadyOrderCard } from '../../components/ReadyOrderCard';
import { SecondaryButton } from '../../components/SecondaryButton';
import { useAuth } from '../../features/auth/store';
import { acceptOrder, fetchAvailableOrders } from '../../features/orders/available';
import { guardDriverError } from '../../features/orders/driverErrors';
import { useNotificationRefresh } from '../../features/notifications/events';
import type { AvailableOrder } from '../../features/orders/types';
import { useFocusedPoll } from '../../features/orders/useFocusedPoll';
import { ar } from '../../i18n/ar';
import { getPermissionState, type PermissionState } from '../../lib/push';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';

const NEW_ORDER_TYPES = ['new_order', 'ready', 'assigned'] as const;

export default function ReadyScreen() {
  const [orders, setOrders] = useState<AvailableOrder[]>([]);
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());
  const [accepting, setAccepting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const name = useAuth((s) => s.profile?.full_name ?? '');

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) {
      setError(ar.common.notConfigured);
      setLoaded(true);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await fetchAvailableOrders(client);
      if (result.ok) {
        setOrders(result.orders);
        // ما اختفى من القائمة لم يعد يحتاج علامة "قبله سائق ثاني"
        setTaken(
          (prev) => new Set([...prev].filter((id) => result.orders.some((o) => o.id === id))),
        );
        setError(null);
      } else if (result.notAllowed) {
        await guardDriverError(client);
      } else {
        setError(result.message);
      }
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, []);

  useFocusedPoll(load);
  // إشعار new_order والتطبيق مفتوح: تحديث فوري (SPEC-driver §2.6)
  useNotificationRefresh(NEW_ORDER_TYPES, () => void load());

  const [permission, setPermission] = useState<PermissionState>('granted');
  useEffect(() => {
    void getPermissionState().then(setPermission);
  }, [orders.length]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function onAccept(id: string) {
    const client = getSupabase();
    if (!client || accepting) return;
    setAccepting(id);
    try {
      const result = await acceptOrder(client, id);
      if (result.ok) {
        router.push(`/order/${result.orderId}`);
      } else if (result.reason === 'taken') {
        setTaken((prev) => new Set(prev).add(id));
      } else if (result.reason === 'not-allowed') {
        await guardDriverError(client);
      } else {
        setError(result.message);
      }
    } finally {
      setAccepting(null);
    }
  }

  const openCount = orders.filter((o) => !taken.has(o.id)).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <AppText size="small" muted>
            {ar.orders.hello(name)}
          </AppText>
          <AppText accessibilityRole="header" weight="bold" size="heading">
            {ar.orders.readyTitle}
          </AppText>
        </View>
        {openCount > 0 ? (
          <View style={styles.badge} testID="ready-count">
            <View style={styles.dot} />
            <AppText weight="bold" size="small" color={colors.primary}>
              {ar.orders.countBadge(openCount)}
            </AppText>
          </View>
        ) : null}
      </View>

      {permission === 'denied' ? (
        <View style={styles.warn} testID="push-off-banner">
          <AppText size="small" color={colors.warningText}>
            {ar.push.offBanner}
          </AppText>
          <SecondaryButton
            title={ar.push.openSettings}
            onPress={() => void Linking.openSettings()}
            testID="push-open-settings"
          />
        </View>
      ) : null}

      {error ? (
        <View style={styles.error} testID="ready-error">
          <AppText color={colors.danger} size="small">
            {error}
          </AppText>
          <SecondaryButton title={ar.orders.retry} onPress={() => void onRefresh()} />
        </View>
      ) : null}

      <FlatList
        testID="ready-list"
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        renderItem={({ item }) => (
          <ReadyOrderCard
            order={item}
            taken={taken.has(item.id)}
            accepting={accepting === item.id}
            onAccept={(id) => void onAccept(id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListEmptyComponent={
          loaded && !error ? (
            <View style={styles.empty}>
              <AppText muted style={styles.emptyText}>
                {ar.orders.readyEmpty}
              </AppText>
            </View>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.screen,
    paddingTop: 18,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: '#E2EFE5',
  },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.primary },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, flexGrow: 1 },
  gap: { height: spacing.md },
  error: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.dangerSoft,
    gap: spacing.xs,
  },
  warn: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.warningSoft,
    gap: spacing.xs,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screen },
  emptyText: { textAlign: 'center' },
});
