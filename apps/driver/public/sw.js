/* خدمة الإشعارات لتطبيق السائق PWA (T38، SPEC-webpush §5.2). لا fetch handler ولا كاش (A2): التحديث = تحميل عادي.
   routeFor() نسخة JS من routeForNotification (src/features/notifications/routing.ts)؛ sw-parity.test.ts يفحص تطابقهما.
   لا تسجيل للـ endpoint أو الحمولة بأي سجل. */
'use strict';

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var CLICK = 'mukhdar:notification-click';
var RECEIVED = 'mukhdar:notification-received';
var CHANGED = 'mukhdar:subscription-change';

function routeFor(data) {
  if (!data || typeof data !== 'object') return null;
  var type = typeof data.type === 'string' ? data.type : null;
  if (!type) return null;
  var id = data.order_id;
  switch (type) {
    case 'new_order':
      return '/';
    case 'ready':
    case 'assigned':
      return typeof id === 'string' && UUID.test(id) ? '/order/' + id : null;
    case 'unassigned':
    case 'cancelled':
      return '/my-orders';
    case 'driver_request_approved':
      return '/auth/pending';
    case 'cash_handover':
      return '/today';
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

function broadcast(message) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    list.forEach(function (c) {
      c.postMessage(message);
    });
  });
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
  var title = typeof payload.title === 'string' && payload.title ? payload.title : 'سائق المخضر';
  var body = typeof payload.body === 'string' ? payload.body : '';
  var tag = (data.type || 'order') + ':' + (data.order_id || '');
  event.waitUntil(
    Promise.all([
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
      broadcast({ type: RECEIVED, data: data }),
    ]),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = cleanData(event.notification.data);
  var route = routeFor(data) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      var open = list.find(function (c) {
        return c.url.indexOf(self.location.origin) === 0 && typeof c.focus === 'function';
      });
      if (open) {
        // R3 L3: إن رُفض التركيز لا يضيع النقر: نفتح المسار بنافذة
        return open
          .focus()
          .then(function () {
            open.postMessage({ type: CLICK, data: data });
          })
          .catch(function () {
            return self.clients.openWindow(route);
          });
      }
      return self.clients.openWindow(route);
    }),
  );
});

// لا RPC من هنا (لا جلسة بالـ SW): التطبيق يعيد التسجيل عند كل تشغيل/رجوع؛ ننبّه النوافذ المفتوحة فقط
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(broadcast({ type: CHANGED }));
});
