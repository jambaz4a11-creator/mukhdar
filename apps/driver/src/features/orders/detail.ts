// تفاصيل طلب معيَّن لي مع بنوده (DRIVER-API §4). RLS: لا صف = ليس لي (نُقل، أُلغي من الحساب، أو غير موجود).
import { parseBackendError, type MukhdarClient } from '@mukhdar/shared';
import type { OrderDetail } from './types';

export const DETAIL_SELECT =
  'id, order_number, status, address_snapshot, customer_name, customer_phone, total_iqd, note, created_at, assigned_at, ' +
  'order_items(name_snapshot, unit_snapshot, qty, price_snapshot_iqd, line_total_iqd)';

export type FetchDetailResult =
  | { ok: true; order: OrderDetail }
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'error'; message: string };

export async function fetchOrderDetail(
  client: MukhdarClient,
  orderId: string,
): Promise<FetchDetailResult> {
  try {
    const { data, error } = await client
      .from('orders')
      .select(DETAIL_SELECT)
      .eq('id', orderId)
      .maybeSingle();
    if (error) return { ok: false, reason: 'error', message: parseBackendError(error).message };
    if (!data) return { ok: false, reason: 'gone' };
    return { ok: true, order: data as unknown as OrderDetail };
  } catch (e) {
    return { ok: false, reason: 'error', message: parseBackendError(e).message };
  }
}
