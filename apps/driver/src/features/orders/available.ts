// الطلبات الجاهزة وقبولها (SPEC-driver §2.6، DRIVER-API §3.1-§3.2).
import { parseBackendError, type MukhdarClient } from '@mukhdar/shared';
import { isDriverAccessError } from './driverErrors';
import type { AvailableOrder } from './types';

export const AVAILABLE_LIMIT = 20;
export const REFRESH_INTERVAL_MS = 30_000;

export type FetchAvailableResult =
  | { ok: true; orders: AvailableOrder[] }
  | { ok: false; notAllowed: true }
  | { ok: false; notAllowed: false; message: string };

export async function fetchAvailableOrders(client: MukhdarClient): Promise<FetchAvailableResult> {
  try {
    const { data, error } = await client.rpc('available_orders', { p_limit: AVAILABLE_LIMIT });
    if (error) {
      const parsed = parseBackendError(error);
      if (isDriverAccessError(parsed.code)) return { ok: false, notAllowed: true };
      return { ok: false, notAllowed: false, message: parsed.message };
    }
    return { ok: true, orders: (data ?? []) as AvailableOrder[] };
  } catch (e) {
    return { ok: false, notAllowed: false, message: parseBackendError(e).message };
  }
}

export type AcceptResult =
  | { ok: true; orderId: string }
  | { ok: false; reason: 'taken' }
  | { ok: false; reason: 'not-allowed' }
  | { ok: false; reason: 'error'; message: string };

/**
 * accept_order ذرّي بالخادم (أول سائق يفوز). `ORDER_NOT_AVAILABLE` = أخذه سائق ثاني (أو لم يعد جاهزاً):
 * البطاقة تُعرض باهتة "قبله سائق ثاني" ثم تُحذف بالتحديث التالي. `NOT_ALLOWED` ← إعادة فحص الحارس (R1 L6).
 */
export async function acceptOrder(client: MukhdarClient, orderId: string): Promise<AcceptResult> {
  try {
    const { data, error } = await client.rpc('accept_order', { p_order_id: orderId });
    if (error) {
      const parsed = parseBackendError(error);
      if (parsed.code === 'ORDER_NOT_AVAILABLE') return { ok: false, reason: 'taken' };
      if (isDriverAccessError(parsed.code)) return { ok: false, reason: 'not-allowed' };
      return { ok: false, reason: 'error', message: parsed.message };
    }
    const id = (data as { id?: unknown } | null)?.id;
    return { ok: true, orderId: typeof id === 'string' ? id : orderId };
  } catch (e) {
    return { ok: false, reason: 'error', message: parseBackendError(e).message };
  }
}
