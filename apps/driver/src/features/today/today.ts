// سجل اليوم (SPEC-driver §2.9، DRIVER-API §4): طلباتي المسلّمة بـ delivered_at ضمن يوم بغداد. قراءة مباشرة بـ RLS
// الموجودة (لا دالة جديدة). الكاش = Σ total_iqd (يشمل أجرة التوصيل: السائق يستلم المجموع كاملاً).
import { baghdadDayRange, parseBackendError, sumCash, type MukhdarClient } from '@mukhdar/shared';
import type { AddressSnapshotView } from '../orders/types';

export const TODAY_LIMIT = 200;
const SELECT = 'id, order_number, total_iqd, delivered_at, address_snapshot';

export interface TodayOrder {
  id: string;
  order_number: number;
  total_iqd: number;
  delivered_at: string;
  address_snapshot: AddressSnapshotView | null;
}

export type FetchTodayResult =
  { ok: true; orders: TodayOrder[]; cash: number; count: number } | { ok: false; message: string };

export async function fetchToday(
  client: MukhdarClient,
  userId: string,
  now: number = Date.now(),
): Promise<FetchTodayResult> {
  const range = baghdadDayRange(now);
  try {
    const { data, error } = await client
      .from('orders')
      .select(SELECT)
      .eq('driver_id', userId)
      .eq('status', 'delivered')
      .gte('delivered_at', range.from)
      .lt('delivered_at', range.to)
      .order('delivered_at', { ascending: false })
      .limit(TODAY_LIMIT);
    if (error) return { ok: false, message: parseBackendError(error).message };
    const orders = (data ?? []) as unknown as TodayOrder[];
    return { ok: true, orders, cash: sumCash(orders), count: orders.length };
  } catch (e) {
    return { ok: false, message: parseBackendError(e).message };
  }
}
