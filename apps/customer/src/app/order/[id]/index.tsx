// تتبع الطلب (T14، SPEC-customer §2.6، تصميم OrderTracking): الحالة، خط زمني بخمس مراحل (أو أُلغي مع السبب)،
// البنود بـ formatQuantity من unit_snapshot، مجاميع الخلفية، العنوان بـ formatAddress، الإلغاء في pending فقط
// (مع تأكيد)، وزر التقييم بعد التسليم إن لم يُقيَّم. التحديث: Realtime + احتياط 30 ثانية (useOrderTracking).
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  canCustomerCancel,
  formatAddress,
  formatIQD,
  formatQuantity,
  isFinalStatus,
  ORDER_FLOW,
  type OrderStatus,
  parseBackendError,
  statusStep,
} from '@mukhdar/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../../components/AppText';
import { FormMessage } from '../../../components/AuthFields';
import { SummaryRow } from '../../../components/SummaryRow';
import { useRequireAuth } from '../../../features/auth/useRequireAuth';
import { canRate, cancelOrder, type OrderDetail, orderKeys } from '../../../features/orders/api';
import { formatOrderDate, formatTime } from '../../../features/orders/format';
import { useOrderTracking } from '../../../features/orders/hooks';
import { ar } from '../../../i18n/ar';
import { getSupabase } from '../../../lib/supabase';
import { colors, radius, sizes, spacing } from '../../../theme';
import { OfflineState } from '../../../components/OfflineState';
import { isFirstLoad, isOfflineEmpty } from '../../../lib/network';

type Params = { id: string; number?: string };
type IconName = ComponentProps<typeof Ionicons>['name'];

const HERO_ICON: Record<OrderStatus, IconName> = {
  pending: 'receipt-outline',
  preparing: 'basket-outline',
  ready: 'bag-check-outline',
  out_for_delivery: 'bicycle-outline',
  delivered: 'checkmark-circle-outline',
  cancelled: 'close-circle-outline',
};

export default function OrderScreen() {
  const session = useRequireAuth();
  const params = useLocalSearchParams<Params>();
  const { order } = useOrderTracking(session ? params.id : undefined);
  if (!session) return null;

  const data = order.data;
  const number = data?.order_number ?? params.number;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ar.order.back}
          onPress={() => (router.canGoBack() ? router.back() : router.navigate('/orders'))}
          style={styles.back}
          testID="order-back"
        >
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
        <View>
          <AppText accessibilityRole="header" weight="bold" size="title">
            {number ? ar.order.title(number) : ar.order.titleNoNumber}
          </AppText>
          {data ? (
            <AppText size="small" muted>
              {formatOrderDate(data.created_at)}
            </AppText>
          ) : null}
        </View>
      </View>

      {data ? (
        <OrderBody order={data} refreshing={order.isRefetching} onRefresh={order.refetch} />
      ) : isFirstLoad(order) ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      ) : isOfflineEmpty(order) ? (
        <OfflineState />
      ) : (
        // مراجعة NH3: النص يقول "اسحب للتحديث"، فالحالة قابلة للسحب
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={
            <RefreshControl
              refreshing={order.isRefetching}
              onRefresh={() => void order.refetch()}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          testID="order-error"
        >
          <AppText muted style={styles.centerText}>
            {order.isError ? ar.order.loadFailed : ar.order.notFound}
          </AppText>
          {order.isError ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void order.refetch()}
              style={styles.link}
            >
              <AppText weight="semibold" color={colors.primary}>
                {ar.order.retry}
              </AppText>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function OrderBody({
  order,
  refreshing,
  onRefresh,
}: {
  order: OrderDetail;
  refreshing: boolean;
  onRefresh: () => unknown;
}) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doCancel() {
    const client = getSupabase();
    if (!client) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelOrder(client, order.id);
    } catch (e) {
      setError(parseBackendError(e).message);
    }
    // نجاح أو فشل (INVALID_TRANSITION = تغيّرت الحالة): الحالة الحقيقية من الخلفية
    await queryClient.invalidateQueries({ queryKey: orderKeys.detail(order.id) });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    setCancelling(false);
  }

  function confirmCancel() {
    Alert.alert(ar.order.cancelTitle, ar.order.cancelBody, [
      { text: ar.order.cancelKeep, style: 'cancel' },
      { text: ar.order.cancelConfirm, style: 'destructive', onPress: () => void doCancel() },
    ]);
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.main}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      <Hero order={order} />

      {order.status === 'delivered' ? (
        order.rating ? (
          <AppText weight="semibold" style={styles.centerText} testID="order-rated">
            {ar.order.rated(order.rating.stars)}
          </AppText>
        ) : canRate(order) ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/order/[id]/rate', params: { id: order.id } })}
            style={styles.rateButton}
            testID="order-rate"
          >
            <Ionicons name="star" size={18} color={colors.star} />
            <AppText weight="bold">{ar.order.rate}</AppText>
          </Pressable>
        ) : null
      ) : null}

      <Timeline order={order} />

      <View style={styles.card}>
        <AppText weight="bold">{ar.order.items}</AppText>
        {order.items.map((item, i) => (
          <SummaryRow
            key={`${item.product_id ?? 'x'}-${i}`}
            label={`${item.name_snapshot} · ${formatQuantity(item.qty, item.unit_snapshot)}`}
            value={formatIQD(item.line_total_iqd)}
          />
        ))}
        <SummaryRow label={ar.order.deliveryFee} value={formatIQD(order.delivery_fee_iqd)} />
        <View style={styles.divider} />
        <SummaryRow
          label={ar.order.total}
          value={formatIQD(order.total_iqd)}
          strong
          testID="order-total"
        />
      </View>

      <View style={[styles.card, styles.addressCard]}>
        <Ionicons name="location-outline" size={22} color={colors.primary} />
        <View style={styles.flex}>
          <AppText testID="order-address">{formatAddress(order.address_snapshot)}</AppText>
          {order.address_snapshot.note ? (
            <AppText size="small" muted>
              {order.address_snapshot.note}
            </AppText>
          ) : null}
        </View>
      </View>

      {order.note ? (
        <View style={styles.card}>
          <AppText weight="bold">{ar.order.note}</AppText>
          <AppText>{order.note}</AppText>
        </View>
      ) : null}

      {error ? <FormMessage text={error} /> : null}

      {canCustomerCancel(order.status) ? (
        <View style={styles.cancelBox}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: cancelling, busy: cancelling }}
            disabled={cancelling}
            onPress={confirmCancel}
            style={styles.cancel}
            testID="order-cancel"
          >
            {cancelling ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <AppText weight="semibold" color={colors.danger}>
                {ar.order.cancel}
              </AppText>
            )}
          </Pressable>
          <AppText size="small" muted style={styles.centerText}>
            {ar.order.cancelHint}
          </AppText>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Hero({ order }: { order: OrderDetail }) {
  const cancelled = order.status === 'cancelled';
  const sub = cancelled
    ? order.cancel_reason
      ? ar.order.cancelReason(order.cancel_reason)
      : null
    : isFinalStatus(order.status)
      ? ar.order.paid(formatIQD(order.total_iqd))
      : ar.order.cashDue(formatIQD(order.total_iqd));
  return (
    <View
      style={[styles.hero, cancelled && styles.heroCancelled]}
      accessibilityRole="summary"
      testID="order-hero"
    >
      <View style={styles.heroIcon}>
        <Ionicons name={HERO_ICON[order.status]} size={28} color={colors.surface} />
      </View>
      <View style={styles.flex}>
        <AppText weight="bold" size="title" color={colors.surface}>
          {ar.order.hero[order.status]}
        </AppText>
        {sub ? (
          <AppText size="small" color={colors.primarySoft}>
            {sub}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const STEP_TIME: Record<(typeof ORDER_FLOW)[number], keyof OrderDetail> = {
  pending: 'created_at',
  preparing: 'preparing_at',
  ready: 'ready_at',
  out_for_delivery: 'out_for_delivery_at',
  delivered: 'delivered_at',
};

type StepState = 'done' | 'current' | 'todo' | 'cancelled';

type Step = { key: string; label: string; time: string | null; state: StepState };

function stepA11yLabel(s: Step): string {
  const parts = [s.label];
  if (s.time && s.state !== 'todo') parts.push(formatTime(s.time));
  const state = ar.order.stepState[s.state];
  if (state) parts.push(state);
  return parts.join('، ');
}

function Timeline({ order }: { order: OrderDetail }) {
  const cancelled = order.status === 'cancelled';
  const current = statusStep(order.status);
  const steps: Step[] = [];

  for (const [i, step] of ORDER_FLOW.entries()) {
    const time = order[STEP_TIME[step]] as string | null;
    if (cancelled) {
      // الملغي: المراحل التي وصلها فقط، ثم سطر الإلغاء
      if (time) steps.push({ key: step, label: ar.order.steps[step], time, state: 'done' });
      continue;
    }
    const state: StepState =
      i < current || (i === current && step === 'delivered')
        ? 'done'
        : i === current
          ? 'current'
          : 'todo';
    steps.push({ key: step, label: ar.order.steps[step], time, state });
  }
  if (cancelled) {
    steps.push({
      key: 'cancelled',
      label: ar.order.cancelledStep,
      time: order.cancelled_at,
      state: 'cancelled',
    });
  }

  return (
    <View style={styles.card} accessibilityLabel={ar.order.stepsA11y} testID="order-timeline">
      {steps.map((s, i) => (
        // مراجعة NH5: كل مرحلة عنصر واحد لقارئ الشاشة ("قيد التحضير، 10:31 ص، مكتملة")
        <View
          key={s.key}
          style={styles.step}
          accessible
          accessibilityLabel={stepA11yLabel(s)}
          accessibilityState={{ selected: s.state === 'current' }}
          testID={`step-${s.key}-${s.state}`}
        >
          <View style={styles.rail}>
            <StepDot state={s.state} />
            {i < steps.length - 1 ? (
              <View style={[styles.line, s.state === 'done' ? styles.lineDone : styles.lineTodo]} />
            ) : null}
          </View>
          <View style={styles.stepText}>
            <AppText
              weight={s.state === 'current' ? 'bold' : s.state === 'todo' ? 'medium' : 'semibold'}
              color={
                s.state === 'current'
                  ? colors.primary
                  : s.state === 'cancelled'
                    ? colors.danger
                    : s.state === 'todo'
                      ? colors.textMuted
                      : undefined
              }
            >
              {s.label}
            </AppText>
            {s.time && s.state !== 'todo' ? (
              <AppText size="caption" muted>
                {formatTime(s.time)}
              </AppText>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function StepDot({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <View style={[styles.dot, styles.dotDone]}>
        <Ionicons name="checkmark" size={16} color={colors.surface} />
      </View>
    );
  }
  if (state === 'cancelled') {
    return (
      <View style={[styles.dot, styles.dotCancelled]}>
        <Ionicons name="close" size={16} color={colors.surface} />
      </View>
    );
  }
  if (state === 'current') {
    return (
      <View style={[styles.dot, styles.dotCurrent]}>
        <View style={styles.dotInner} />
      </View>
    );
  }
  return <View style={[styles.dot, styles.dotTodo]} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { marginTop: spacing.screen * 2 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screen },
  centerText: { textAlign: 'center' },
  link: { minHeight: sizes.touchTarget, justifyContent: 'center' },
  main: { paddingHorizontal: spacing.screen, paddingBottom: spacing.screen, gap: spacing.lg },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  heroCancelled: { backgroundColor: colors.danger },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.card,
    backgroundColor: 'rgba(255,255,255,0.15)', // أبيض شفاف فوق لون البطاقة (مثل التصميم)
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: sizes.primaryButton,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  addressCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  divider: { height: 1, backgroundColor: colors.border },
  step: { flexDirection: 'row', gap: 14 },
  rail: { alignItems: 'center' },
  line: { width: 2, height: 30 },
  lineDone: { backgroundColor: colors.primary },
  lineTodo: { backgroundColor: colors.border },
  stepText: { paddingTop: 2 },
  dot: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.primary },
  dotCancelled: { backgroundColor: colors.danger },
  dotCurrent: { borderWidth: 3, borderColor: colors.primary, backgroundColor: colors.surface },
  dotInner: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.primary },
  dotTodo: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  cancelBox: { gap: spacing.xs },
  cancel: {
    minHeight: sizes.touchTarget,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
