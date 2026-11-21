// متحكم Web Push لتطبيق السائق (T38): مثيل واحد من createWebPush (@mukhdar/shared) فوق التخزين المشفَّر.
// يُستورد من وحدات الويب فقط (push.web.ts، PushPrompt.web.tsx، NotificationsBridge.web.tsx).
// EXPO_PUBLIC_VAPID_PUBLIC_KEY مفتاح عام (يُضمَّن بالـ bundle عمداً)؛ المفتاح الخاص سر Edge فقط.
import { createWebPush, type WebPushController } from '@mukhdar/shared';
import { secureStorage } from './secureStorage';

export const PENDING_DELETE_KEY = 'mukhdar.driver.pushTokenPendingDelete';
export const PUSH_SNOOZE_KEY = 'mukhdar.driver.pushSnoozeUntil';

let instance: WebPushController | null = null;

export function getWebPush(): WebPushController {
  instance ??= createWebPush({
    vapidPublicKey: process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY,
    storage: secureStorage,
    pendingKey: PENDING_DELETE_KEY,
    snoozeKey: PUSH_SNOOZE_KEY,
  });
  return instance;
}

/** مفتاح VAPID العام مضبوط وقت البناء. */
export function hasVapidKey(): boolean {
  return !!process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
}
