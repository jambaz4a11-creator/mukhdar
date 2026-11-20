// التحويلات التي يملكها السائق (SPEC-driver §6، DRIVER-API §3.3): ready ← out_for_delivery ← delivered فقط.
// قاعدة البيانات تفرض التحويلات والصلاحية؛ هذا لإظهار الزر المناسب ومعالجة الأخطاء.
import {
  parseBackendError,
  STATUS_LABELS,
  type MukhdarClient,
  type OrderStatus,
} from '@mukhdar/shared';
import { ar } from '../../i18n/ar';
import { isDriverAccessError } from './driverErrors';
import type { MyOrder } from './types';

export type DriverTarget = 'out_for_delivery' | 'delivered';
export interface DriverAction {
  to: DriverTarget;
  /** نافذة تأكيد ثانية تعرض المبلغ (التسليم) */
  confirm: boolean;
}

/** الزر الثابت لكل حالة. `preparing` ← null (زر معطّل "بانتظار التحضير" بالشاشة)؛ النهائية ← بلا زر. */
export function nextAction(status: OrderStatus): DriverAction | null {
  switch (status) {
    case 'ready':
      return { to: 'out_for_delivery', confirm: false };
    case 'out_for_delivery':
      return { to: 'delivered', confirm: true };
    default:
      return null;
  }
}

/** تسميات السائق للحالات الجارية (التصميم)؛ النهائية من الحزمة المشتركة. */
export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case 'out_for_delivery':
      return ar.orders.statusOnTheWay;
    case 'ready':
      return ar.orders.statusAccepted;
    case 'preparing':
      return ar.orders.statusPreparing;
    default:
      return STATUS_LABELS[status];
  }
}

export type SetStatusResult =
  | { ok: true; order: Pick<MyOrder, 'id' | 'status'> }
  | { ok: false; reason: 'invalid-transition' }
  | { ok: false; reason: 'not-allowed' }
  | { ok: false; reason: 'error'; message: string };

/** `set_order_status(id, status)`: السائق لا يرسل `p_return_stock` أبداً. */
export async function setOrderStatus(
  client: MukhdarClient,
  orderId: string,
  to: DriverTarget,
): Promise<SetStatusResult> {
  try {
    const { data, error } = await client.rpc('set_order_status', {
      p_order_id: orderId,
      p_status: to,
    });
    if (error) {
      const parsed = parseBackendError(error);
      if (parsed.code === 'INVALID_TRANSITION') return { ok: false, reason: 'invalid-transition' };
      if (isDriverAccessError(parsed.code)) return { ok: false, reason: 'not-allowed' };
      return { ok: false, reason: 'error', message: parsed.message };
    }
    const row = (data ?? {}) as { id?: string; status?: OrderStatus };
    return { ok: true, order: { id: row.id ?? orderId, status: row.status ?? to } };
  } catch (e) {
    return { ok: false, reason: 'error', message: parseBackendError(e).message };
  }
}
