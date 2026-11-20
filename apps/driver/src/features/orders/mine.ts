// طلباتي (SPEC-driver §2.7، DRIVER-API §4-§5): الاستعلام، الإزالة عند الاختفاء/الإلغاء، واشتراك Realtime.
import { parseBackendError, type MukhdarClient } from '@mukhdar/shared';
import type { MyOrder } from './types';

export const ACTIVE_STATUSES = ['preparing', 'ready', 'out_for_delivery'] as const;
const LIST_SELECT =
  'id, order_number, status, address_snapshot, customer_name, customer_phone, total_iqd, note, created_at, assigned_at';

export type FetchMineResult = { ok: true; orders: MyOrder[] } | { ok: false; message: string };

export async function fetchMyOrders(
  client: MukhdarClient,
  userId: string,
): Promise<FetchMineResult> {
  try {
    const { data, error } = await client
      .from('orders')
      .select(LIST_SELECT)
      .eq('driver_id', userId)
      .in('status', [...ACTIVE_STATUSES])
      .order('created_at');
    if (error) return { ok: false, message: parseBackendError(error).message };
    return { ok: true, orders: (data ?? []) as unknown as MyOrder[] };
  } catch (e) {
    return { ok: false, message: parseBackendError(e).message };
  }
}

export interface RemovedOrder {
  id: string;
  /** cancelled = ألغاه الزبون/الأدمن؛ gone = نُقل لسائق آخر أو اختفى (النقل لا يصل بـ Realtime، DRIVER-API §5) */
  reason: 'cancelled' | 'gone';
}

/**
 * طلبات كانت بقائمتي وزالت بالقائمة الجديدة. `delivered` (أنهته اللوحة بدلاً منه) ليس إزالة بالرسالة؛
 * أما الغائب كلياً فلا نعرف سببه (نُقل، أُلغي، سُلّم) فنقول "ما بقى بطلباتك".
 */
export function removedOrders(prev: readonly MyOrder[], next: readonly MyOrder[]): RemovedOrder[] {
  const byId = new Map(next.map((o) => [o.id, o]));
  const removed: RemovedOrder[] = [];
  for (const old of prev) {
    const now = byId.get(old.id);
    if (!now) removed.push({ id: old.id, reason: 'gone' });
    else if (now.status === 'cancelled') removed.push({ id: old.id, reason: 'cancelled' });
  }
  return removed;
}

let channelSeq = 0;

interface RealtimeClient {
  channel(name: string): {
    on(type: 'postgres_changes', filter: object, cb: () => void): unknown;
    subscribe(): unknown;
  };
  removeChannel(channel: unknown): unknown;
}

/**
 * Realtime على طلباتي فقط (`driver_id=eq.<me>`): أي تغيير ← `onChange` (نعيد الجلب بدل ترقيع الصف). يرجع دالة الإلغاء
 * (إلغاء الاشتراك عند الاختفاء/الخروج). النقل بعيداً عنا لا يصل هنا، فالتحديث الدوري يغطيه.
 */
export function subscribeMyOrders(
  client: MukhdarClient,
  userId: string,
  onChange: () => void,
): () => void {
  const c = client as unknown as RealtimeClient;
  // R2 C1: realtime-js يرجع القناة المنضمّة نفسها لنفس الاسم، و`.on()` بعد `subscribe()` يرمي. فلكل اشتراك اسم فريد،
  // وإلغاؤه لا يمس اشتراك شاشة أخرى (طلباتي وتفاصيل الطلب يعملان معاً).
  const channel = c.channel(`driver-orders-${userId}-${++channelSeq}`);
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'orders', filter: `driver_id=eq.${userId}` },
    onChange,
  );
  channel.subscribe();
  return () => {
    void c.removeChannel(channel);
  };
}
