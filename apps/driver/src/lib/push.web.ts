// الويب (PWA السائق، T37): بديل مؤقت بلا إشعارات. Web Push الفعلي (PushManager + sw.js + register_web_push) بـ T38.
// نفس أسماء التصدير وتواقيعها للنسخة الأصلية (push.ts) ولا يستورد expo-notifications/expo-device
// (web-platform.test.ts). الدوال بلا معاملات مُسندة لأنواع بمعاملات: نفس التوقيع للمستدعين بلا متغيرات غير مستعملة.
import type { MukhdarClient } from '@mukhdar/shared';

export const ANDROID_CHANNEL_ID = 'orders';
export const PUSH_TOKEN_KEY = 'mukhdar.driver.pushToken';
export const PENDING_UNREGISTER_KEY = 'mukhdar.driver.pushTokenPendingDelete';

export function configureNotificationHandler(): void {}

export function canUseRemotePush(): boolean {
  return false;
}

export function getExpoPushTokenIfAllowed(): Promise<string | null> {
  return Promise.resolve(null);
}

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** unavailable: شريط "الإشعارات مطفية" لا يظهر على الويب حتى T38. */
export function getPermissionState(): Promise<PermissionState> {
  return Promise.resolve('unavailable');
}

export type RegisterResult = 'registered' | 'unsupported' | 'denied' | 'pin-required' | 'failed';

export const registerPushToken: (
  client: MukhdarClient,
  options: { ask: boolean },
) => Promise<RegisterResult> = () => Promise.resolve('unsupported');

/** لا رمز على الويب بعد: لا شيء لحذفه. */
export const unregisterPushToken: (client: MukhdarClient) => Promise<boolean> = () =>
  Promise.resolve(true);

export const removePushForSignOut: (client: MukhdarClient) => Promise<void> = () =>
  Promise.resolve();

export const retryPendingPushUnregister: (client: MukhdarClient) => Promise<void> = () =>
  Promise.resolve();
