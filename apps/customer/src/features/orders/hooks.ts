// hooks الطلبات (T14). التتبع: Realtime على orders بفلتر id=eq.<id>، يُلغى عند حالة نهائية أو مغادرة الشاشة،
// واحتياطاً إعادة جلب كل 30 ثانية ما دام الاشتراك غير متصل والطلب غير منتهٍ (SPEC-customer §2.6).
import { isFinalStatus, type MukhdarClient, type OrderStatus } from '@mukhdar/shared';
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/store';
import {
  fetchOrder,
  fetchOrdersPage,
  nextOrdersCursor,
  type OrderDetail,
  type OrderListItem,
  orderKeys,
  type OrdersCursor,
} from './api';

export const ORDER_FALLBACK_REFETCH_MS = 30_000;

/** الاحتياط: إعادة جلب كل 30 ثانية فقط إن كان الطلب غير منتهٍ والاشتراك غير متصل. */
export function fallbackInterval(status: OrderStatus | undefined, live: boolean): number | false {
  if (live || !status || isFinalStatus(status)) return false;
  return ORDER_FALLBACK_REFETCH_MS;
}

export function useOrder(id: string | undefined, live = false) {
  const client = getSupabase();
  return useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: () => fetchOrder(client as MukhdarClient, id as string),
    enabled: client !== null && !!id,
    // live من useOrderRealtime: متصل = لا إعادة دورية
    refetchInterval: (query) => fallbackInterval(query.state.data?.status, live),
  });
}

export function useMyOrders() {
  const client = getSupabase();
  const userId = useAuth((s) => s.session?.user.id);
  return useInfiniteQuery({
    queryKey: orderKeys.list(userId),
    queryFn: ({ pageParam }) =>
      fetchOrdersPage(client as MukhdarClient, userId as string, pageParam),
    initialPageParam: null as OrdersCursor | null,
    getNextPageParam: (lastPage) => nextOrdersCursor(lastPage),
    enabled: client !== null && !!userId,
  });
}

/** أعمدة الطلب التي ترجع من Realtime (صف orders كامل). */
type OrderRow = Partial<Omit<OrderDetail, 'items' | 'rating'>> & { id: string };

/** يدمج تحديث Realtime بالطلب المخزن وبقوائم "طلباتي" (البنود والتقييم لا تتغير من هذا الحدث). */
export function applyOrderUpdate(queryClient: QueryClient, row: OrderRow) {
  queryClient.setQueryData<OrderDetail | null>(orderKeys.detail(row.id), (old) =>
    old ? { ...old, ...pickOrderFields(row) } : old,
  );
  queryClient.setQueriesData<InfiniteData<OrderListItem[]>>({ queryKey: ['orders'] }, (old) => {
    if (!old || !Array.isArray(old.pages)) return old;
    return {
      ...old,
      pages: old.pages.map((page) =>
        page.map((o) =>
          o.id === row.id
            ? { ...o, status: row.status ?? o.status, total_iqd: row.total_iqd ?? o.total_iqd }
            : o,
        ),
      ),
    };
  });
}

const DETAIL_FIELDS = [
  'status',
  'subtotal_iqd',
  'delivery_fee_iqd',
  'total_iqd',
  'note',
  'preparing_at',
  'ready_at',
  'out_for_delivery_at',
  'delivered_at',
  'cancelled_at',
  'cancel_reason',
] as const;

function pickOrderFields(row: OrderRow): Partial<OrderDetail> {
  const out: Record<string, unknown> = {};
  for (const key of DETAIL_FIELDS) if (key in row) out[key] = row[key];
  return out as Partial<OrderDetail>;
}

export interface OrderChannelHandlers {
  onUpdate: (row: OrderRow) => void;
  /** true عند SUBSCRIBED، و false عند أي انقطاع (CHANNEL_ERROR، TIMED_OUT، CLOSED) */
  onConnected: (connected: boolean) => void;
}

/** اشتراك Realtime بطلب واحد. يرجع دالة الإلغاء (removeChannel). */
export function subscribeToOrder(
  client: MukhdarClient,
  id: string,
  handlers: OrderChannelHandlers,
): () => void {
  const channel = client
    .channel(`order:${id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
      (payload) => handlers.onUpdate(payload.new as OrderRow),
    )
    .subscribe((status) => handlers.onConnected(status === 'SUBSCRIBED'));
  return () => {
    void client.removeChannel(channel);
  };
}

/**
 * يشترك ما دام الطلب غير منتهٍ والشاشة مفتوحة. يرجع connected: false = الاحتياط (30 ثانية) فعّال.
 * عند كل اتصال (أول مرة أو بعد انقطاع) يُعاد جلب الطلب لالتقاط ما فات أثناء الانقطاع.
 */
export function useOrderRealtime(id: string | undefined, status: OrderStatus | undefined): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const active = !!id && !!status && !isFinalStatus(status);

  useEffect(() => {
    const client = getSupabase();
    if (!active || !client || !id) {
      setConnected(false);
      return;
    }
    const unsubscribe = subscribeToOrder(client, id, {
      onUpdate: (row) => {
        applyOrderUpdate(queryClient, row);
      },
      onConnected: (ok) => {
        setConnected(ok);
        if (ok) void queryClient.invalidateQueries({ queryKey: orderKeys.detail(id) });
      },
    });
    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [active, id, queryClient]);

  return active && connected;
}

/** شاشة التتبع: الطلب + Realtime + الاحتياط. live = الاشتراك متصل (لا حاجة للإعادة الدورية). */
export function useOrderTracking(id: string | undefined) {
  const [status, setStatus] = useState<OrderStatus | undefined>(undefined);
  const live = useOrderRealtime(id, status);
  const order = useOrder(id, live);
  const current = order.data?.status;
  useEffect(() => setStatus(current), [current]);
  return { order, live };
}
