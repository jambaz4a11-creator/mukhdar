// يُركَّب داخل الجذر بعد جاهزية التنقل (T14): يسجّل رمز الجهاز عند كل دخول وعند تغيّر الرمز، ويوجّه الضغط على
// الإشعار (حتى لو فتح التطبيق من الإغلاق) إلى الطلب أو التقييم. لا يعرض شيئاً.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { getSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/store';
import { canUseRemotePush, registerPushToken } from './push';
import { routeForNotification } from './routing';

export function NotificationsBridge() {
  const userId = useAuth((s) => s.session?.user.id);
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const client = getSupabase();
    if (!userId || !client || !canUseRemotePush()) return;
    // بدون نافذة إذن: يسجّل فقط إن كان الإذن ممنوحاً (الطلب الأول يسأل، askAfterFirstOrder)
    void registerPushToken(client, { ask: false });
    const sub = Notifications.addPushTokenListener(() => {
      void registerPushToken(client, { ask: false });
    });
    return () => sub.remove();
  }, [userId]);

  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const route = routeForNotification(response.notification.request.content.data);
    if (route) router.push(route);
    Notifications.clearLastNotificationResponse();
  }, [response]);

  return null;
}
