// متحكم Web Push لتطبيق الزبون (T38): مثيل واحد من createWebPush (@mukhdar/shared) فوق التخزين المشفَّر.
// يُستورد من وحدات الويب فقط. EXPO_PUBLIC_VAPID_PUBLIC_KEY مفتاح عام؛ المفتاح الخاص سر Edge فقط.
import { createWebPush, type WebPushController } from '@mukhdar/shared';
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

/** iOS خارج الـ PWA المثبَّت: الإشعارات تعمل بعد التثبيت فقط (SPEC-webpush §3.2). */
export function needsInstall(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as {
    userAgent?: string;
    standalone?: boolean;
    maxTouchPoints?: number;
  };
  const ua = nav.userAgent ?? '';
  const ios =
    /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  if (!ios) return false;
  let standalone = nav.standalone === true;
  try {
    standalone ||= window.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    // لا شيء
  }
  return !standalone;
}
