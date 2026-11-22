// سجل اليوم (SPEC-cash §5 يحل محل SPEC-driver §2.9، التصميم Today): "الكاش اللي بيدك" = driver_cash_summary() منذ آخر
// تسليم (لا مجموع بالتطبيق)، "توصيلات اليوم" (يوم بغداد)، قائمة الطلبات التي فلوسها بيدك (عرض فقط)، ورابط سجل التسليمات.
// يُحدَّث عند الفتح والرجوع للتطبيق (useFocusedPoll)، وبالسحب، وعند وصول إشعار cash_handover.
import { formatAddressShort } from '@mukhdar/shared';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { useAuth } from '../../features/auth/store';
import {
  fetchCashSummary,
  fetchInHandOrders,
  type CashSummary,
  type InHandOrder,
} from '../../features/cash/cash';
import { useNotificationRefresh } from '../../features/notifications/events';
import { guardDriverError, isDriverAccessError } from '../../features/orders/driverErrors';
import { formatBaghdadClock } from '../../features/orders/time';
import { useFocusedPoll } from '../../features/orders/useFocusedPoll';
import {
  formatBaghdadDateLabel,
  formatBaghdadDayMonth,
  groupDigits,
} from '../../features/today/date';
import { fetchToday } from '../../features/today/today';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';

const CASH_NOTIFICATIONS = ['cash_handover'] as const;

/** "من آخر تسليم 18 تشرين الثاني · 6:30 م" أو "ما سلّمت كاش بعد". */
function sinceText(s: CashSummary): string {
  if (!s.last_handover_at) return ar.today.neverHandedOver(s.order_count);
  const when = `${formatBaghdadDayMonth(s.last_handover_at)} · ${formatBaghdadClock(s.last_handover_at)}`;
  return ar.today.since(s.order_count, when);
}

export default function TodayScreen() {
  const userId = useAuth((s) => s.session?.user.id ?? null);
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [orders, setOrders] = useState<InHandOrder[]>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // R2 L3: لا جلبان متداخلان (30 ثانية + رجوع للتطبيق + إشعار)
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client || !userId || inFlight.current) return;
    inFlight.current = true;
    try {
      const [cash, inHand, today] = await Promise.all([
        fetchCashSummary(client),
        fetchInHandOrders(client, userId),
        fetchToday(client, userId),
      ]);
      if (cash.ok) setSummary(cash.summary);
      if (inHand.ok) setOrders(inHand.orders);
      if (today.ok) setTodayCount(today.count);
      const failure = [cash, inHand, today].find((r) => !r.ok);
      setError(failure && !failure.ok ? failure.message : null);
      // NOT_ALLOWED (سائق عُطّل للتو)، أو قراءة صفر بـ RLS بدل خطأ: نعيد فحص الحارس فيحوّله لـ "غير مفعّل"
      const denied = !cash.ok && isDriverAccessError(cash.code);
      if (denied || (inHand.ok && today.ok && inHand.orders.length === 0 && today.count === 0)) {
        await guardDriverError(client);
      }
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [userId]);

  useFocusedPoll(load);
  // استلم المحل كاشك والتطبيق مفتوح: الرقم يتحدث فوراً
  useNotificationRefresh(CASH_NOTIFICATIONS, () => void load());

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  const goodsOnly = summary ? !summary.includes_delivery_fee : false;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <AppText accessibilityRole="header" weight="bold" size="heading">
          {ar.today.title}
        </AppText>
        <AppText size="small" muted>
          {formatBaghdadDateLabel()}
        </AppText>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        testID="today-scroll"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.cards}>
          <View style={[styles.card, styles.cashCard]} testID="today-cash">
            <AppText size="small" color="#E2EFE5">
              {goodsOnly ? ar.today.cashGoodsOnly : ar.today.cash}
            </AppText>
            <AppText weight="bold" size="heading" color={colors.surface}>
              {summary ? groupDigits(summary.outstanding_iqd) : '—'}
            </AppText>
            <AppText size="caption" color="#E2EFE5">
              {ar.today.currency}
            </AppText>
          </View>
          <View style={[styles.card, styles.countCard]} testID="today-count">
            <AppText size="small" muted>
              {ar.today.count}
            </AppText>
            <AppText weight="bold" size="heading">
              {String(todayCount)}
            </AppText>
            <AppText size="caption" muted>
              {ar.today.countUnit}
            </AppText>
          </View>
        </View>

        {summary ? (
          <View style={styles.sinceBox}>
            <AppText size="small" muted testID="today-cash-since">
              {sinceText(summary)}
            </AppText>
            {goodsOnly ? (
              <AppText
                size="small"
                weight="semibold"
                color={colors.primary}
                testID="today-fee-note"
              >
                {ar.today.feeStays}
              </AppText>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/cash/history')}
          style={styles.link}
          testID="today-history-link"
        >
          <AppText weight="semibold" color={colors.primary}>
            {ar.today.historyLink}
          </AppText>
        </Pressable>

        {error ? (
          <View style={styles.error} testID="today-error">
            <AppText size="small" color={colors.danger}>
              {error}
            </AppText>
          </View>
        ) : null}

        <AppText weight="bold" size="small" style={styles.listTitle}>
          {ar.today.list}
        </AppText>
        {orders.length > 0 ? (
          <View style={styles.list}>
            {orders.map((o, i) => (
              <View
                key={o.id}
                style={[styles.row, i < orders.length - 1 && styles.rowBorder]}
                testID={`today-row-${o.id}`}
              >
                <View>
                  <AppText weight="semibold">
                    {`#${o.order_number} · ${formatAddressShort({
                      subsection: o.address_snapshot?.subsection ?? '',
                      building: o.address_snapshot?.building ?? '',
                    }).replace(' - ', ' · ')}`}
                  </AppText>
                  <AppText size="caption" muted>
                    {formatBaghdadClock(o.delivered_at)}
                  </AppText>
                </View>
                <AppText weight="bold">{groupDigits(o.total_iqd)}</AppText>
              </View>
            ))}
          </View>
        ) : loaded && !error ? (
          <AppText muted style={styles.empty} testID="today-empty">
            {ar.today.empty}
          </AppText>
        ) : null}
        <AppText size="caption" muted style={styles.note}>
          {ar.today.note}
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.screen, paddingTop: 18, paddingBottom: spacing.md },
  content: { padding: spacing.lg, gap: spacing.md },
  cards: { flexDirection: 'row', gap: spacing.sm },
  card: { flex: 1, borderRadius: 18, padding: spacing.lg, gap: 4 },
  cashCard: { backgroundColor: colors.primary },
  countCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sinceBox: { gap: 4 },
  link: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  listTitle: { marginTop: 6 },
  list: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
  },
  row: {
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  empty: { textAlign: 'center', paddingVertical: spacing.lg },
  note: { textAlign: 'center' },
  error: { padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.dangerSoft },
});
