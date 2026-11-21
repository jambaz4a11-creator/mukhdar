// الويب (PWA السائق، T38): Web Push فوق PushManager + sw.js + register_web_push (SPEC-webpush §5). نفس أسماء التصدير
// وتواقيعها للنسخة الأصلية (push.ts) ولا يستورد expo-notifications/expo-device (web-platform.test.ts).
// الإذن لا يُطلب هنا أبداً بلا لمسة: registerPushToken(..., {ask:true}) يُستدعى من زر بطاقة التمهيد فقط (PushPrompt.web).
import type { MukhdarClient } from '@mukhdar/shared';
import { getWebPush, hasVapidKey, PENDING_DELETE_KEY } from './webPushController';

export const ANDROID_CHANNEL_ID = 'orders';
export const PUSH_TOKEN_KEY = 'mukhdar.driver.pushToken';
export const PENDING_UNREGISTER_KEY = PENDING_DELETE_KEY;

export function configureNotificationHandler(): void {}

export function canUseRemotePush(): boolean {
  return hasVapidKey() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export function getExpoPushTokenIfAllowed(): Promise<string | null> {
  return Promise.resolve(null);
}

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** unavailable: شريط "الإشعارات مطفية" الأصلي لا يظهر بالويب (زر فتح الإعدادات لا يعمل)؛ PushPrompt.web يعرض بديله. */
export function getPermissionState(): Promise<PermissionState> {
  return Promise.resolve('unavailable');
}

export type RegisterResult = 'registered' | 'unsupported' | 'denied' | 'pin-required' | 'failed';

export const registerPushToken: (
  client: MukhdarClient,
  options: { ask: boolean },
) => Promise<RegisterResult> = (client, options) => getWebPush().register(client, options);

/** حذف صف الاشتراك ثم unsubscribe (الحذف المؤجَّل بلا شبكة داخل remove). true دائماً: لا يعطّل الخروج. */
export const unregisterPushToken: (client: MukhdarClient) => Promise<boolean> = async (client) => {
  await getWebPush().remove(client);
  return true;
};

export const removePushForSignOut: (client: MukhdarClient) => Promise<void> = (client) =>
  getWebPush().remove(client);

export const retryPendingPushUnregister: (client: MukhdarClient) => Promise<void> = (client) =>
  getWebPush().retryPending(client);
