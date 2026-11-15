// طلباتي (T14، SPEC-customer §2.7، تصميم Orders): الأحدث أولاً، صفحات 20 بـ keyset على created_at، شارة الحالة
// من @mukhdar/shared، "اطلب مرة أخرى" (المتوفر فقط، ويخبر بما لم يُضف)، و"قيّم الطلب" بعد التسليم إن لم يُقيَّم.
// محمية بالدخول (T10).
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatIQD, isFinalStatus } from '@mukhdar/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { StatusBadge } from '../../components/StatusBadge';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { useCart } from '../../features/cart/store';
import { canRate, fetchReorderPlan, type OrderListItem } from '../../features/orders/api';
import { formatOrderDate } from '../../features/orders/format';
import { useMyOrders } from '../../features/orders/hooks';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, sizes, spacing } from '../../theme';

export default function OrdersScreen() {
  const session = useRequireAuth();
  const orders = useMyOrders();
  if (!session) return null;

  const list = orders.data?.pages.flat() ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <AppText accessibilityRole="header" weight="bold" size="heading">
          {ar.orders.title}
        </AppText>
      </View>
      {orders.isPending && orders.fetchStatus !== 'idle' ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      ) : orders.isError && list.length === 0 ? (
        <View style={styles.empty}>
          <AppText muted>{ar.orders.loadFailed}</AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => void orders.refetch()}
            style={styles.link}
          >
            <AppText weight="semibold" color={colors.primary}>
              {ar.orders.retry}
            </AppText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          style={styles.flex}
          data={list}
          keyExtractor={(o) => o.id}
          contentContainerStyle={[styles.list, list.length === 0 && styles.flexGrow]}
          renderItem={({ item }) => <OrderCard order={item} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (orders.hasNextPage && !orders.isFetchingNextPage) void orders.fetchNextPage();
          }}
          refreshControl={
            <RefreshControl
              refreshing={orders.isRefetching && !orders.isFetchingNextPage}
              onRefresh={() => void orders.refetch()}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={<EmptyOrders />}
          ListFooterComponent={
            orders.isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} testID="orders-more" />
            ) : list.length > 0 ? (
              <AppText size="small" muted style={styles.hint}>
                {ar.orders.pageHint}
              </AppText>
            ) : undefined
          }
        />
      )}
    </SafeAreaView>
  );
}

function EmptyOrders() {
  return (
    <View style={styles.empty} testID="orders-empty">
      <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
      <AppText weight="semibold" size="title">
        {ar.orders.empty}
      </AppText>
      <AppText muted>{ar.orders.emptyHint}</AppText>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate('/')}
        style={styles.link}
      >
        <AppText weight="semibold" color={colors.primary}>
          {ar.orders.browse}
        </AppText>
      </Pressable>
    </View>
  );
}

function OrderCard({ order }: { order: OrderListItem }) {
  const [busy, setBusy] = useState(false);
  const reorderable = isFinalStatus(order.status) && order.items.length > 0;
  const rateable = canRate(order);

  async function reorder() {
    const client = getSupabase();
    if (!client || busy) return;
    setBusy(true);
    try {
      const plan = await fetchReorderPlan(client, order.items);
      const add = useCart.getState().add;
      for (const line of plan.add) add(line.id, line.qty);
      const lines = [
        plan.add.length > 0 ? ar.orders.reorderAdded(plan.add.length) : ar.orders.reorderNone,
        plan.skipped.length > 0 && plan.add.length > 0
          ? ar.orders.reorderSkipped(plan.skipped.join('، '))
          : null,
      ].filter((l): l is string => l !== null);
      Alert.alert(
        ar.orders.reorderTitle,
        lines.join('\n'),
        plan.add.length > 0
          ? [
              { text: ar.orders.ok, style: 'cancel' },
              { text: ar.orders.viewCart, onPress: () => router.navigate('/cart') },
            ]
          : [{ text: ar.orders.ok }],
      );
    } catch {
      Alert.alert(ar.orders.reorderTitle, ar.orders.reorderFailed);
    }
    setBusy(false);
  }

  return (
    <View style={styles.card} testID={`order-card-${order.id}`}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
        style={styles.cardLink}
      >
        <View style={styles.row}>
          <AppText weight="bold">{ar.order.title(order.order_number)}</AppText>
          <StatusBadge status={order.status} testID={`order-status-${order.id}`} />
        </View>
        <View style={styles.row}>
          <AppText size="small" muted style={styles.flex}>
            {`${formatOrderDate(order.created_at)} · ${ar.orders.itemsCount(order.items.length)}`}
          </AppText>
          <AppText weight="bold">{formatIQD(order.total_iqd)}</AppText>
        </View>
      </Pressable>
      {reorderable || rateable ? (
        <View style={styles.actions}>
          {reorderable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy }}
              disabled={busy}
              onPress={() => void reorder()}
              style={[styles.action, styles.reorder]}
              testID={`order-reorder-${order.id}`}
            >
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="refresh" size={16} color={colors.primary} />
                  <AppText size="small" weight="semibold" color={colors.primary}>
                    {ar.orders.reorder}
                  </AppText>
                </>
              )}
            </Pressable>
          ) : null}
          {rateable ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: '/order/[id]/rate', params: { id: order.id } })
              }
              style={[styles.action, styles.rate]}
              testID={`order-rate-${order.id}`}
            >
              <Ionicons name="star" size={16} color={colors.star} />
              <AppText size="small" weight="semibold">
                {ar.orders.rate}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1 },
  header: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.screen,
    paddingBottom: spacing.md,
  },
  loading: { marginTop: spacing.screen * 2 },
  list: { paddingHorizontal: spacing.screen, paddingBottom: spacing.lg, gap: spacing.md },
  card: {
    gap: spacing.sm,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardLink: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  actions: { flexDirection: 'row', gap: spacing.xs },
  action: {
    flex: 1,
    minHeight: sizes.touchTarget,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  reorder: { backgroundColor: colors.primarySoft },
  rate: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  hint: { textAlign: 'center', marginTop: 4 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.screen,
  },
  link: { minHeight: sizes.touchTarget, justifyContent: 'center' },
});
