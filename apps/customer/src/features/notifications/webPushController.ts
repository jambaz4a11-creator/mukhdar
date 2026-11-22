// متحكم Web Push لتطبيق الزبون (T38): مثيل واحد من createWebPush (@mukhdar/shared) فوق التخزين المشفَّر.
// يُستورد من وحدات الويب فقط. EXPO_PUBLIC_VAPID_PUBLIC_KEY مفتاح عام؛ المفتاح الخاص سر Edge فقط.
import {
  createWebPush,
  iosNeedsInstall,
  readBrowserInstallEnv,
  type WebPushController,
} from '@mukhdar/shared';
import { secureStorage } from '../../lib/secureStorage';

export const PENDING_DELETE_KEY = 'mukhdar.pushTokenPendingDelete';
export const PUSH_SNOOZE_KEY = 'mukhdar.pushSnoozeUntil';

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

export function hasVapidKey(): boolean {
  return !!process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
}

/** iOS خارج الـ PWA المثبَّت: الإشعارات تعمل بعد التثبيت فقط (SPEC-webpush §3.2). الكشف المشترك (R3 L6). */
export function needsInstall(): boolean {
  if (typeof window === 'undefined') return false;
  return iosNeedsInstall(
    readBrowserInstallEnv(window as unknown as Parameters<typeof readBrowserInstallEnv>[0]),
  );
}
