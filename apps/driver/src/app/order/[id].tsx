// تفاصيل الطلب (SPEC-driver §2.8، التصميم OrderDetail): العنوان الكامل بمربعات (G للأرضي) بعد القبول فقط، الزبون
// (اتصال/واتساب)، المنتجات، ملاحظة الزبون، الكاش، والزر الثابت حسب الحالة. التسليم بتأكيد مزدوج يعرض المبلغ.
import Ionicons from '@expo/vector-icons/Ionicons';
import { displayPhone, formatIQD, formatQuantity, telUrl } from '@mukhdar/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AddressBlocks } from '../../components/AddressBlocks';
import { AppText } from '../../components/AppText';
import { BackButton } from '../../components/BackButton';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatusBadge } from '../../components/StatusBadge';
import { config } from '../../config';
import { useAuth } from '../../features/auth/store';
import { isDeletedCustomerSnapshot } from '../../features/orders/address';
import { customerTelUrl, customerWhatsappUrl } from '../../features/orders/contact';
import { fetchOrderDetail } from '../../features/orders/detail';
import { guardDriverError } from '../../features/orders/driverErrors';
import { subscribeMyOrders } from '../../features/orders/mine';
import { formatBaghdadClock } from '../../features/orders/time';
import { nextAction, setOrderStatus } from '../../features/orders/transitions';
import type { OrderDetail, OrderItemView } from '../../features/orders/types';
import { useNotificationRefresh } from '../../features/notifications/events';
import { useFocusedPoll } from '../../features/orders/useFocusedPoll';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';

function quantityText(item: OrderItemView): string {
  try {
    return formatQuantity(item.qty, item.unit_snapshot);
  } catch {
    return `${item.qty} ${item.unit_snapshot}`;
  }
}

type Blocked = 'not-yours' | 'gone' | null;

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuth((s) => s.session?.user.id ?? null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [blocked, setBlocked] = useState<Blocked>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client || !id || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await fetchOrderDetail(client, id);
      if (result.ok) {
        setOrder(result.order);
        setError(null);
      } else if (result.reason === 'gone') {
        setBlocked((b) => b ?? 'gone');
      } else {
        setError(result.message);
      }
    } finally {
      inFlight.current = false;
    }
  }, [id]);

  useFocusedPoll(load);
  useNotificationRefresh(null, () => void load());

  // الأدمن/اللوحة قد يغيّر الحالة (يؤدي الاستلام أو التسليم نيابة عنه): Realtime على طلباتي يعيد الجلب
  useEffect(() => {
    const client = getSupabase();
    if (!client || !userId) return undefined;
    return subscribeMyOrders(client, userId, () => void load());
  }, [userId, load]);

  async function perform(to: 'out_for_delivery' | 'delivered') {
    const client = getSupabase();
    if (!client || !id || busy) return;
    setBusy(true);
    try {
      const result = await setOrderStatus(client, id, to);
      if (result.ok) {
        setConfirming(false);
        setError(null);
        if (to === 'delivered') router.replace('/my-orders');
        else await load();
      } else if (result.reason === 'invalid-transition') {
        // تغيّرت الحالة (من اللوحة مثلاً): نعيد الجلب فيظهر الزر الصحيح
        setConfirming(false);
        await load();
      } else if (result.reason === 'not-allowed') {
        setConfirming(false);
        setBlocked('not-yours');
        await guardDriverError(client);
      } else {
        setConfirming(false);
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function onAction() {
    if (!order) return;
    const action = nextAction(order.status);
    if (!action) return;
    if (action.confirm) setConfirming(true);
    else void perform(action.to);
  }

  if (blocked) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center} testID={`blocked-${blocked}`}>
          <AppText weight="bold" size="title" style={styles.centerText}>
            {blocked === 'not-yours' ? ar.orders.notYours : ar.orders.gone}
          </AppText>
          <PrimaryButton
            title={ar.orders.backToMine}
            onPress={() => router.replace('/my-orders')}
            testID={blocked === 'not-yours' ? 'not-yours-ok' : 'gone-ok'}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe}>
        <BackButton label={ar.orders.backToMine} fallback="/my-orders" />
        <View style={styles.center}>
          <AppText muted>{error ?? ar.common.loading}</AppText>
        </View>
      </SafeAreaView>
    );
  }

  const deleted = isDeletedCustomerSnapshot(order.address_snapshot, order.customer_name);
  const tel = customerTelUrl(order.customer_phone);
  const whatsapp = customerWhatsappUrl(order.customer_phone);
  const shopTel = telUrl(config.shopPhone);
  const action = nextAction(order.status);
  const note = (order.note ?? '').trim();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <BackButton label={ar.orders.backToMine} fallback="/my-orders" />
        <View style={styles.headerText}>
          <AppText accessibilityRole="header" weight="bold" size="title">
            {ar.orders.detailTitle(order.order_number)}
          </AppText>
          {order.assigned_at ? (
            <AppText size="small" muted>
              {ar.orders.acceptedAt(formatBaghdadClock(order.assigned_at))}
            </AppText>
          ) : null}
        </View>
        <StatusBadge status={order.status} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <View style={styles.error} testID="detail-error">
            <AppText size="small" color={colors.danger}>
              {error}
            </AppText>
          </View>
        ) : null}

        <AddressBlocks snapshot={order.address_snapshot} />

        <View style={styles.card}>
          <View style={styles.customer}>
            <AppText weight="bold">
              {deleted ? ar.orders.deletedCustomer : (order.customer_name ?? '')}
            </AppText>
            {!deleted && order.customer_phone ? (
              <AppText size="small" muted style={styles.phone}>
                {displayPhone(order.customer_phone)}
              </AppText>
            ) : null}
          </View>
          {!deleted && tel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ar.orders.callCustomer}
              onPress={() => void Linking.openURL(tel)}
              style={styles.iconButton}
              testID="call-customer"
            >
              <Ionicons name="call-outline" size={22} color={colors.primary} />
            </Pressable>
          ) : null}
          {!deleted && whatsapp ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ar.orders.whatsappCustomer}
              onPress={() => void Linking.openURL(whatsapp)}
              style={styles.iconButton}
              testID="whatsapp-customer"
            >
              <Ionicons name="logo-whatsapp" size={22} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.card, styles.column]}>
          <AppText weight="bold" size="small">
            {ar.orders.productsTitle}
          </AppText>
          {order.order_items.map((item, i) => (
            <View key={`${item.name_snapshot}-${i}`} style={styles.itemRow}>
              <AppText size="small">{item.name_snapshot}</AppText>
              <AppText size="small">{quantityText(item)}</AppText>
            </View>
          ))}
          {note ? (
            <View style={styles.note} testID="detail-note">
              <AppText size="small" color="#6B3A08">{`${ar.orders.customerNote} ${note}`}</AppText>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, styles.cashCard]} testID="detail-cash">
          <AppText weight="semibold">{ar.orders.cashLabel}</AppText>
          <AppText weight="bold" size="heading" color={colors.primary}>
            {formatIQD(order.total_iqd)}
          </AppText>
        </View>

        {shopTel ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(shopTel)}
            style={styles.problem}
            testID="detail-problem"
          >
            <AppText size="small" color={colors.primary} weight="semibold">
              {ar.orders.problem}
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>

      {order.status === 'preparing' ? (
        <View style={styles.footer}>
          <PrimaryButton
            title={ar.orders.waitPreparing}
            onPress={() => undefined}
            disabled
            testID="detail-waiting"
          />
        </View>
      ) : action ? (
        <View style={styles.footer}>
          <PrimaryButton
            title={action.to === 'delivered' ? ar.orders.delivered : ar.orders.pickedUp}
            onPress={onAction}
            loading={busy && !confirming}
            testID="detail-action"
          />
          <AppText size="caption" muted style={styles.hint}>
            {action.to === 'delivered' ? ar.orders.footerOnTheWayHint : ar.orders.footerReadyHint}
          </AppText>
        </View>
      ) : null}

      <ConfirmSheet
        visible={confirming}
        amountText={formatIQD(order.total_iqd)}
        busy={busy}
        onConfirm={() => void perform('delivered')}
        onCancel={() => setConfirming(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingEnd: spacing.lg },
  headerText: { flex: 1, paddingTop: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  column: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.xs },
  customer: { flex: 1 },
  phone: { writingDirection: 'ltr' },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#E2EFE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between' },
  note: {
    marginTop: 4,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.warningSoft,
  },
  cashCard: { justifyContent: 'space-between' },
  problem: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.screen,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hint: { textAlign: 'center' },
  error: { padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.dangerSoft },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.screen,
  },
  centerText: { textAlign: 'center' },
});
