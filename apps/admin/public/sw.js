/* خدمة الإشعارات للوحة الأدمن PWA (T44، SPEC-admin-push §6). لا fetch handler ولا كاش: التحديث = تحميل عادي.
   routeFor() نسخة JS من routeForAdminNotification (src/features/notifications/routing.ts)؛ sw.test.ts يفحص تطابقهما.
   لا تسجيل للـ endpoint أو الحمولة بأي سجل. */
'use strict';

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function routeFor(data) {
  if (!data || typeof data !== 'object') return null;
  var type = typeof data.type === 'string' ? data.type : null;
  if (!type) return null;
  var id = data.order_id;
  switch (type) {
    case 'new_order':
    case 'customer_cancelled':
      return typeof id === 'string' && UUID.test(id)
        ? '/orders?order=' + id.toLowerCase()
        : '/orders';
    case 'driver_request':
      return '/driver-requests';
    case 'low_stock':
      return '/stock';
    default:
      return null;
  }
}

/** من الحمولة نأخذ order_id وtype فقط (نصوص) ولا شيء آخر. */
function cleanData(data) {
  var out = {};
  if (data && typeof data === 'object') {
    if (typeof data.order_id === 'string') out.order_id = data.order_id;
    if (typeof data.type === 'string') out.type = data.type;
  }
  return out;
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

// يعرض إشعاراً دائماً (شرط iOS: دفع بلا إشعار ظاهر يُلغي الاشتراك)، مهما كان المحتوى
self.addEventListener('push', function (event) {
  var payload;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== 'object') payload = {};
  var data = cleanData(payload.data);
  var title =
    typeof payload.title === 'string' && payload.title ? payload.title : 'لوحة سوق بسماوي';
  var body = typeof payload.body === 'string' ? payload.body : '';
  var tag = (data.type || 'panel') + ':' + (data.order_id || '');
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      lang: 'ar',
      dir: 'rtl',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: tag,
      renotify: true,
      data: data,
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var route = routeFor(cleanData(event.notification.data)) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      var open = list.find(function (c) {
        return c.url.indexOf(self.location.origin) === 0 && typeof c.focus === 'function';
      });
      if (!open) return self.clients.openWindow(route);
      // نافذة اللوحة مفتوحة: نركّزها وننقلها للمسار؛ أي فشل (نافذة غير مُتحكَّم بها، رفض التركيز) ← نافذة جديدة
      return open
        .focus()
        .then(function (c) {
          var target = c || open;
          if (typeof target.navigate !== 'function') throw new Error('no navigate');
          return target.navigate(route);
        })
        .catch(function () {
          return self.clients.openWindow(route);
        });
    }),
  );
});

// لا RPC من هنا (لا جلسة بالـ SW): اللوحة تعيد التسجيل الصامت عند كل فتح
self.addEventListener('pushsubscriptionchange', function () {});
