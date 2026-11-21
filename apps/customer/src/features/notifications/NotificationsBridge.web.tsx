// الويب (T38، SPEC-webpush §5.7): تسجيل صامت لاشتراك Web Push عند كل تشغيل/رجوع للتبويب بجلسة زبون (بلا طلب إذن)، وإعادة
// حذف اشتراك خرج صاحبه بلا اتصال، ورسائل sw.js: "وصل إشعار" ← تحديث الطلبات، و"نُقر إشعار" ← routeForNotification
// (UUID فقط) إلى تتبع الطلب (أو التقييم عند التسليم). نفس أسماء التصدير للنسخة الأصلية.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { getSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/store';
import { orderKeys } from '../orders/api';
import { canUseRemotePush, registerPushToken } from './push';
import { retryPendingPushUnregister } from './push.web';
import { routeForNotification } from './routing';

const CLICK = 'mukhdar:notification-click';
const RECEIVED = 'mukhdar:notification-received';
const CHANGED = 'mukhdar:subscription-change';

interface SwContainer {
  addEventListener(type: 'message', fn: (e: { data?: unknown }) => void): void;
  removeEventListener(type: 'message', fn: (e: { data?: unknown }) => void): void;
}

export function NotificationsBridge() {
  const userId = useAuth((s) => s.session?.user.id);
  const mustChangePin = useAuth((s) => s.mustChangePin);
  const ready = useAuth((s) => s.ready);
  const queryClient = useQueryClient();

  useEffect(() => {
    const client = getSupabase();
    if (!userId || mustChangePin || !client || !canUseRemotePush()) return undefined;
    void retryPendingPushUnregister(client);
    const silent = () => void registerPushToken(client, { ask: false });
    silent();
    const onVisible = () => {
      if (document.visibilityState === 'visible') silent();
    };
    document.addEventListener('visibilitychange', onVisible);
    const sw = navigator.serviceWorker as unknown as SwContainer;
    const onChanged = (e: { data?: unknown }) => {
      if ((e.data as { type?: string } | undefined)?.type === CHANGED) silent();
    };
    sw.addEventListener('message', onChanged);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      sw.removeEventListener('message', onChanged);
    };
  }, [userId, mustChangePin]);

  useEffect(() => {
    if (!ready || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }
    const sw = navigator.serviceWorker as unknown as SwContainer;
    const onMessage = (e: { data?: unknown }) => {
      const msg = e.data as { type?: string; data?: unknown } | undefined;
      if (msg?.type === RECEIVED) {
        if (routeForNotification(msg.data)) {
          void queryClient.invalidateQueries({ queryKey: orderKeys.all });
        }
      } else if (msg?.type === CLICK) {
        // بلا جلسة: شاشة الطلب نفسها تحوّل للدخول (useRequireAuth) ثم ترجع
        const route = routeForNotification(msg.data);
        if (route) router.push(route);
      }
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [ready, queryClient]);

  return null;
}
