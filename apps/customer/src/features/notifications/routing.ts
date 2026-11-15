// التوجيه عند الضغط على إشعار (T14، SPEC-customer §3). بيانات إشعار الزبون من push-dispatch:
// { order_id, status }. التسليم يفتح شاشة التقييم، وبقية الحالات تفتح تتبع الطلب. دالة نقية (تُختبر وحدها).
export type NotificationRoute =
  | { pathname: '/order/[id]'; params: { id: string } }
  | { pathname: '/order/[id]/rate'; params: { id: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function routeForNotification(data: unknown): NotificationRoute | null {
  if (!data || typeof data !== 'object') return null;
  const { order_id: id, status } = data as Record<string, unknown>;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (status === 'delivered') return { pathname: '/order/[id]/rate', params: { id } };
  return { pathname: '/order/[id]', params: { id } };
}
