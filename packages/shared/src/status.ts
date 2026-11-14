// حالات الطلب. التحويلات الحقيقية تُفرض داخل set_order_status؛ هذه للعرض وإظهار الأزرار المناسبة.
import type { OrderStatus } from './types';

/** كل الحالات بترتيب العرض (المسار الطبيعي ثم الإلغاء). */
export const ORDER_STATUSES = [
  'pending',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const satisfies readonly OrderStatus[];

/** خطوات الخط الزمني للزبون (بدون الإلغاء). */
export const ORDER_FLOW = [
  'pending',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
] as const satisfies readonly OrderStatus[];

/** الأسماء العربية (SPEC-customer §2.6). */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'تم الاستلام',
  preparing: 'قيد التحضير',
  ready: 'جاهز، بانتظار السائق',
  out_for_delivery: 'بالطريق',
  delivered: 'تم التوصيل',
  cancelled: 'أُلغي',
};

/** ألوان الشارة: نص وخلفية فاتحة (افتراض؛ SPEC-customer افتراضات). */
export const STATUS_COLORS: Record<OrderStatus, { text: string; background: string }> = {
  pending: { text: '#8A5A00', background: '#FFF4D6' },
  preparing: { text: '#1D5FA8', background: '#E3EEFB' },
  ready: { text: '#00695C', background: '#E0F2EF' },
  out_for_delivery: { text: '#6B3FA0', background: '#EFE6FA' },
  delivered: { text: '#2E7D32', background: '#E4F3E5' },
  cancelled: { text: '#B3261E', background: '#FBE5E3' },
};

/** التحويلات الصحيحة (مطابقة لـ set_order_status). الصلاحية حسب الدور تتحقق منها قاعدة البيانات. */
export const STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function isFinalStatus(status: OrderStatus): boolean {
  return STATUS_TRANSITIONS[status].length === 0;
}

/** الزبون يلغي طلبه فقط وهو pending. */
export function canCustomerCancel(status: OrderStatus): boolean {
  return status === 'pending';
}

/** موقع الحالة بالخط الزمني (0..4)، و -1 للملغي. */
export function statusStep(status: OrderStatus): number {
  return (ORDER_FLOW as readonly OrderStatus[]).indexOf(status);
}
