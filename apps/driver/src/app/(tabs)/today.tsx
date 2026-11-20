// سجل اليوم (SPEC-driver §2.9، التصميم Today): "الكاش اللي بيدك" و"توصيلات اليوم" وقائمة التوصيلات. اليوم بتوقيت بغداد.
// يُحدَّث عند الفتح والرجوع للتطبيق (startPendingPoll يشمل ذلك).
import { formatAddressShort } from '@mukhdar/shared';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { useAuth } from '../../features/auth/store';
import { guardDriverError } from '../../features/orders/driverErrors';
import { formatBaghdadClock } from '../../features/orders/time';
import { useFocusedPoll } from '../../features/orders/useFocusedPoll';
import { formatBaghdadDateLabel, groupDigits } from '../../features/today/date';
import { fetchToday, type TodayOrder } from '../../features/today/today';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';

export default function TodayScreen() {
  const userId = useAuth((s) => s.session?.user.id ?? null);
  const [orders, setOrders] = useState<TodayOrder[]>([]);
  const [cash, setCash] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // R2 L3: لا جلبان متداخلان (30 ثانية + رجوع للتطبيق + إشعار)
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client || !userId || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await fetchToday(client, userId);
      if (result.ok) {
        setOrders(result.orders);
        setCash(result.cash);
        setError(null);
        // سائق عُطّل للتو يقرأ صفراً بـ RLS بدل خطأ: نعيد فحص الحارس عند القائمة الفارغة فيحوّله لـ "غير مفعّل"
        if (result.orders.length === 0) await guardDriverError(client);
      } else {
        setError(result.message);
      }
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [userId]);

  useFocusedPoll(load);

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
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.cards}>
          <View style={[styles.card, styles.cashCard]} testID="today-cash">
            <AppText size="small" color="#E2EFE5">
              {ar.today.cash}
            </AppText>
            <AppText weight="bold" size="heading" color={colors.surface}>
              {groupDigits(cash)}
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
              {String(orders.length)}
            </AppText>
            <AppText size="caption" muted>
              {ar.today.countUnit}
            </AppText>
          </View>
        </View>

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
