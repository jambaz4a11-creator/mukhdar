// توجيه نقر إشعار اللوحة (T44، SPEC-admin-push §1 و§6). public/sw.js فيه نسخة JS مطابقة (sw.test.ts يفحصهما معاً).
// أنواع معروفة فقط، ومعرّف الطلب UUID فقط: لا مسار مزوَّر من حمولة. الـ proxy يقرر الصلاحية بعدها (الموظف على
// /driver-requests ← "غير مصرح").
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminPushType = 'new_order' | 'customer_cancelled' | 'driver_request' | 'low_stock';

export function routeForAdminNotification(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { type, order_id: id } = data as { type?: unknown; order_id?: unknown };
  if (typeof type !== 'string') return null;
  switch (type) {
    case 'new_order':
    case 'customer_cancelled':
      return typeof id === 'string' && UUID.test(id)
        ? `/orders?order=${id.toLowerCase()}`
        : '/orders';
    case 'driver_request':
      return '/driver-requests';
    case 'low_stock':
      return '/stock';
    default:
      return null;
  }
}
