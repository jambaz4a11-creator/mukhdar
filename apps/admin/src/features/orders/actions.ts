// أزرار الإجراءات بلوحة تفاصيل الطلب حسب (الحالة × الدور). مطابقة لـ set_order_status وassign_driver
// (SPEC-backend §5)؛ قاعدة البيانات تفرض الصلاحية فعلاً، وهذه لإظهار الأزرار الصحيحة فقط.
import type { OrderStatus } from '@mukhdar/shared';
import type { PanelRole } from '@/lib/access';

export type OrderAction = 'start_preparing' | 'mark_ready' | 'assign_driver' | 'cancel';

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
  if (CANCELLABLE[role].includes(status)) actions.push('cancel');
  return actions;
}

export const ACTION_LABELS: Record<OrderAction, string> = {
  start_preparing: 'بدء التحضير',
  mark_ready: 'الطلب جاهز',
  assign_driver: 'تعيين سائق',
  cancel: 'إلغاء الطلب',
};

/** الحالة الهدف لكل زر يستدعي set_order_status. */
export const ACTION_TARGET: Partial<Record<OrderAction, OrderStatus>> = {
  start_preparing: 'preparing',
  mark_ready: 'ready',
  cancel: 'cancelled',
};

export const CANCEL_REASON_MAX = 300;

/** سبب الإلغاء إلزامي (يظهر للزبون بالإشعار وبسجل الطلب)، ويُقص بقاعدة البيانات لـ 300. */
export function validateCancelReason(reason: string): string | null {
  const r = reason.trim();
  if (r.length === 0) return 'اكتب سبب الإلغاء';
  if (r.length > CANCEL_REASON_MAX) return `السبب أطول من ${CANCEL_REASON_MAX} حرف`;
  return null;
}
