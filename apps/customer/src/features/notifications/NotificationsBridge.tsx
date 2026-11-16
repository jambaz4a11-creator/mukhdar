// يُركَّب داخل الجذر بعد جاهزية التنقل (T14): يسجّل رمز الجهاز عند كل دخول وعند تغيّر الرمز، ويوجّه الضغط على
// الإشعار (حتى لو فتح التطبيق من الإغلاق) إلى الطلب أو التقييم، ويحدّث الطلبات عند وصول إشعار طلب والتطبيق
// مفتوح (مراجعة NH9). لا يعرض شيئاً.
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { getSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/store';
import { orderKeys } from '../orders/api';
import { canUseRemotePush, registerPushToken } from './push';
import { routeForNotification } from './routing';

export function NotificationsBridge() {
  const userId = useAuth((s) => s.session?.user.id);
  // رمز مؤقت: الخادم يرفض تسجيل الرمز (PIN_CHANGE_REQUIRED)؛ نسجّله بعد تغيير الرمز (H1، جلسة C)
  const mustChangePin = useAuth((s) => s.mustChangePin);
  const response = Notifications.useLastNotificationResponse();
  const queryClient = useQueryClient();

  useEffect(() => {
    const client = getSupabase();
    if (!userId || mustChangePin || !client || !canUseRemotePush()) return;
    // بدون نافذة إذن: يسجّل فقط إن كان الإذن ممنوحاً (الطلب الأول يسأل، askAfterFirstOrder)
    void registerPushToken(client, { ask: false });
    const sub = Notifications.addPushTokenListener(() => {
      void registerPushToken(client, { ask: false });
    });
    return () => sub.remove();
  }, [userId, mustChangePin]);

  // إشعار تغيّر حالة طلب والتطبيق بالواجهة: "طلباتي" وشاشة الطلب تتحدثان فوراً (لا انتظار Realtime أو التركيز)
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (routeForNotification(notification.request.content.data)) {
        void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const route = routeForNotification(response.notification.request.content.data);
    if (route) router.push(route);
    Notifications.clearLastNotificationResponse();
  }, [response]);

  return null;
}
