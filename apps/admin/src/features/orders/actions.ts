// أزرار الإجراءات بلوحة تفاصيل الطلب حسب (الحالة × الدور). مطابقة لـ set_order_status وassign_driver
// (SPEC-backend §5)؛ قاعدة البيانات تفرض الصلاحية فعلاً، وهذه لإظهار الأزرار الصحيحة فقط.
import type { OrderStatus } from '@mukhdar/shared';
import type { PanelRole } from '@/lib/access';

export type OrderAction =
  | 'start_preparing'
  | 'mark_ready'
  | 'assign_driver'
  | 'mark_out_for_delivery'
  | 'mark_delivered'
  | 'cancel';

/** الإلغاء: الموظف حتى `ready`، والأدمن أيضاً من `out_for_delivery`. */
const CANCELLABLE: Record<PanelRole, readonly OrderStatus[]> = {
  staff: ['pending', 'preparing', 'ready'],
  admin: ['pending', 'preparing', 'ready', 'out_for_delivery'],
};

export function orderActions(status: OrderStatus, role: PanelRole): OrderAction[] {
  const actions: OrderAction[] = [];
  if (status === 'pending') actions.push('start_preparing');
  if (status === 'preparing') actions.push('mark_ready');
  if (status === 'preparing' || status === 'ready') actions.push('assign_driver');
  // احتياطي (2026-11-16): بدل السائق إن كان تطبيقه معطّلاً أو نسي (SPEC-admin §2.1)
  if (status === 'ready') actions.push('mark_out_for_delivery');
  if (status === 'out_for_delivery') actions.push('mark_delivered');
  if (CANCELLABLE[role].includes(status)) actions.push('cancel');
  return actions;
}

export const ACTION_LABELS: Record<OrderAction, string> = {
  start_preparing: 'بدء التحضير',
  mark_ready: 'الطلب جاهز',
  assign_driver: 'تعيين سائق',
  mark_out_for_delivery: 'بالطريق (بدل السائق)',
  mark_delivered: 'تم التوصيل (بدل السائق)',
  cancel: 'إلغاء الطلب',
};

/** الحالة الهدف لكل زر يستدعي set_order_status. */
export const ACTION_TARGET: Partial<Record<OrderAction, OrderStatus>> = {
  start_preparing: 'preparing',
  mark_ready: 'ready',
  mark_out_for_delivery: 'out_for_delivery',
  mark_delivered: 'delivered',
  cancel: 'cancelled',
};

/** سبب تعطيل زر (يظهر بجانبه)، أو null إن كان متاحاً. */
export function actionBlocked(
  action: OrderAction,
  order: { driver_id: string | null },
): string | null {
  if (action === 'mark_out_for_delivery' && !order.driver_id) return 'عيّن سائقاً أولاً';
  return null;
}

/** الإجراءات الاحتياطية تحتاج تأكيداً (التسليم يثبت المبيعات ويحدّث الإحصاءات). */
export const CONFIRM_ACTIONS: readonly OrderAction[] = ['mark_out_for_delivery', 'mark_delivered'];

export const CANCEL_REASON_MAX = 300;

/** سبب الإلغاء إلزامي (يظهر للزبون بالإشعار وبسجل الطلب)، ويُقص بقاعدة البيانات لـ 300. */
export function validateCancelReason(reason: string): string | null {
  const r = reason.trim();
  if (r.length === 0) return 'اكتب سبب الإلغاء';
  if (r.length > CANCEL_REASON_MAX) return `السبب أطول من ${CANCEL_REASON_MAX} حرف`;
  return null;
}
