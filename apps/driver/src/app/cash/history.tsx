// سجل التسليمات (SPEC-cash §5): my_cash_handovers، صفحات 20 بالتمرير (keyset). الوقت (بغداد)، "استلم المحل X"، "المطلوب Y" إن
// اختلف، شارة نقص/زيادة، الملاحظة (نص صرف)، "استلمها <الاسم الأول>"، و"تعدّل" إن صُحِّح. يُحدَّث عند الظهور وبالسحب وبإشعار
// cash_handover (يرجع لأول صفحة).
import { formatIQD } from '@mukhdar/shared';
import { useCallback, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { BackButton } from '../../components/BackButton';
import { useAuth } from '../../features/auth/store';
import {
  CASH_HISTORY_PAGE,
  fetchCashHistory,
  handoverBadge,
  type CashHandover,
  type HistoryCursor,
} from '../../features/cash/cash';
import { useNotificationRefresh } from '../../features/notifications/events';
import { formatBaghdadClock } from '../../features/orders/time';
import { useFocusedPoll } from '../../features/orders/useFocusedPoll';
import { formatBaghdadDayMonth } from '../../features/today/date';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';

const CASH_NOTIFICATIONS = ['cash_handover'] as const;

function HandoverRow({ h }: { h: CashHandover }) {
  const badge = handoverBadge(h.difference_iqd);
  const t = ar.cashHistory;
  return (
    <View style={styles.card} testID={`history-row-${h.id}`}>
      <View style={styles.top}>
        <AppText size="small" muted>
          {`${formatBaghdadDayMonth(h.recorded_at)} · ${formatBaghdadClock(h.recorded_at)}`}
        </AppText>
        <AppText size="caption" muted>
          {t.orders(h.order_count)}
        </AppText>
      </View>
      <AppText weight="bold" size="title">
        {t.received(formatIQD(h.received_iqd))}
      </AppText>
      {badge ? (
        <View style={styles.badges}>
          <AppText size="small" muted>
            {t.expected(formatIQD(h.expected_iqd))}
          </AppText>
          <View
            style={[styles.badge, badge.kind === 'shortage' ? styles.shortage : styles.overage]}
            testID={`history-badge-${h.id}`}
          >
            <AppText
              size="caption"
              weight="bold"
              color={badge.kind === 'shortage' ? colors.danger : colors.warningText}
            >
              {badge.kind === 'shortage'
                ? t.shortage(formatIQD(badge.amount))
                : t.overage(formatIQD(badge.amount))}
            </AppText>
          </View>
        </View>
      ) : null}
      {h.note ? <AppText size="small">{h.note}</AppText> : null}
      <View style={styles.top}>
        {h.recorded_by_name ? (
          <AppText size="caption" muted>
            {t.by(h.recorded_by_name)}
          </AppText>
        ) : (
          <View />
        )}
        {h.corrected_at ? (
          <AppText size="caption" weight="semibold" color={colors.warningText}>
            {t.corrected}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export default function CashHistoryScreen() {
  const userId = useAuth((s) => s.session?.user.id ?? null);
  const [items, setItems] = useState<CashHandover[]>([]);
  const [next, setNext] = useState<HistoryCursor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // لا جلبان متداخلان (30 ثانية + رجوع + إشعار + تمرير)
  const inFlight = useRef(false);

  /** يرجع لأول صفحة ويستبدل القائمة (فتح، سحب، إشعار، استطلاع). */
  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client || !userId || inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetchCashHistory(client, null);
      if (r.ok) {
        setItems(r.items);
        setNext(r.next);
        setError(null);
      } else {
        setError(r.message);
      }
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [userId]);

  /** الصفحة التالية بالتمرير: المؤشر = آخر صف. */
  const loadMore = useCallback(async () => {
    const client = getSupabase();
    if (!client || !next || inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetchCashHistory(client, next);
      if (r.ok) {
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...r.items.filter((i) => !seen.has(i.id))];
        });
        setNext(r.next);
        setError(null);
      } else {
        setError(r.message);
      }
    } finally {
      inFlight.current = false;
    }
  }, [next]);

  useFocusedPoll(load);
  useNotificationRefresh(CASH_NOTIFICATIONS, () => void load());

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
      <BackButton label={ar.cashHistory.back} fallback="/today" />
      <View style={styles.header}>
        <AppText accessibilityRole="header" weight="bold" size="heading">
          {ar.cashHistory.title}
        </AppText>
      </View>
      {error ? (
        <View style={styles.error} testID="history-error">
          <AppText size="small" color={colors.danger}>
            {error}
          </AppText>
        </View>
      ) : null}
      <FlatList
        testID="history-list"
        data={items}
        keyExtractor={(h) => h.id}
        renderItem={({ item }) => <HandoverRow h={item} />}
        contentContainerStyle={styles.content}
        initialNumToRender={CASH_HISTORY_PAGE}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loaded && !error ? (
            <AppText muted style={styles.empty} testID="history-empty">
              {ar.cashHistory.empty}
            </AppText>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.md },
  content: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: spacing.lg,
    gap: 6,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full },
  shortage: { backgroundColor: colors.dangerSoft },
  overage: { backgroundColor: colors.warningSoft },
  empty: { textAlign: 'center', paddingVertical: spacing.lg },
  error: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.dangerSoft,
  },
});
