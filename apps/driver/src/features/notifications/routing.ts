// التوجيه عند الضغط على إشعار (SPEC-driver §2.11، DRIVER-API §6). دالة نقية. data.type من push-dispatch:
// new_order ← الجاهزة؛ ready/assigned ← الطلب؛ unassigned/cancelled ← طلباتي؛ driver_request_approved ← Pending؛ cash_handover ← اليوم.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function notificationType(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const t = (data as Record<string, unknown>).type;
  return typeof t === 'string' ? t : null;
}

export function routeForNotification(data: unknown): string | null {
  const type = notificationType(data);
  if (!type) return null;
  const id = (data as Record<string, unknown>).order_id;
  switch (type) {
    case 'new_order':
      return '/';
    case 'ready':
    case 'assigned':
      return typeof id === 'string' && UUID.test(id) ? `/order/${id}` : null;
    case 'unassigned':
    case 'cancelled':
      return '/my-orders';
    case 'driver_request_approved':
      return '/auth/pending';
    // T42: استلم المحل كاشك (أو صحّح التسليم) ← سجل اليوم (التحديث بالشاشة نفسها عند الظهور والإشعار)
    case 'cash_handover':
      return '/today';
    default:
      return null;
  }
}
