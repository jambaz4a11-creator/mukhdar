// الويب (T37): بلا عمل حتى T38 (expo-notifications لا يدعم الإشعارات البعيدة على الويب؛ T38 يستمع لرسائل sw.js
// ويمرّرها لـ routeForNotification نفسها). نفس أسماء التصدير للنسخة الأصلية.
export const PUSH_ASKED_KEY = 'mukhdar.driver.pushAsked';

export function NotificationsBridge() {
  return null;
}
