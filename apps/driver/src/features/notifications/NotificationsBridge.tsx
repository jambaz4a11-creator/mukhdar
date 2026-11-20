// يُركَّب بالجذر (T32، SPEC-driver §2.11): يسجّل رمز الجهاز عند كل تشغيل بجلسة سائق فعّالة وبعد الدخول وبعد تغيير
// الرمز المؤقت (الخادم يرفض الحساب المؤشَّر)، ويسأل الإذن مرة واحدة بعد أول دخول، ويوجّه الضغط على الإشعار حسب
// data.type (حتى لو فتح التطبيق من الإغلاق التام)، ويبلّغ الشاشات بإشعار وصل والتطبيق مفتوح. لا يعرض شيئاً.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { getSupabase } from '../../lib/supabase';
import { canUseRemotePush, registerPushToken } from '../../lib/push';
import { isGuardBlocking } from '../auth/guard';
import { useAuth } from '../auth/store';
import { emitNotification } from './events';
import { routeForNotification } from './routing';

export const PUSH_ASKED_KEY = 'mukhdar.driver.pushAsked';

export function NotificationsBridge() {
  const userId = useAuth((s) => s.session?.user.id);
  const isActiveDriver = useAuth(
    (s) => s.profile?.role === 'driver' && s.profile.is_active && !s.profile.must_change_pin,
  );
  const state = useAuth();
  const response = Notifications.useLastNotificationResponse();

  // تسجيل الرمز: كل تشغيل/دخول/بعد تغيير الرمز المؤقت. الإذن يُسأل مرة واحدة بعد أول دخول.
  useEffect(() => {
    const client = getSupabase();
    if (!userId || !isActiveDriver || !client || !canUseRemotePush()) return undefined;
    void (async () => {
      let ask: boolean;
      try {
        ask = (await AsyncStorage.getItem(PUSH_ASKED_KEY)) === null;
        if (ask) await AsyncStorage.setItem(PUSH_ASKED_KEY, '1');
      } catch {
        ask = false;
      }
      await registerPushToken(client, { ask });
    })();
    const sub = Notifications.addPushTokenListener(() => {
      void registerPushToken(client, { ask: false });
    });
    return () => sub.remove();
  }, [userId, isActiveDriver]);

  // وصل إشعار والتطبيق مفتوح: تحديث الشاشات المعنية فوراً
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      emitNotification(n.request.content.data);
    });
    return () => sub.remove();
  }, []);

  // الضغط على الإشعار (ومنه فتح التطبيق من الإغلاق): ننتظر الحارس حتى يعرف الوجهة ثم نوجّه
  const guardReady = !isGuardBlocking(state);
  useEffect(() => {
    if (!response || !guardReady) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const route = routeForNotification(response.notification.request.content.data);
    if (route) router.push(route as never);
    Notifications.clearLastNotificationResponse();
  }, [response, guardReady]);

  return null;
}
