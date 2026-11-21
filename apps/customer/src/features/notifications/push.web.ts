// الويب (PWA الزبون، T38): Web Push فوق PushManager + sw.js + register_web_push (SPEC-webpush §5.7). نفس أسماء التصدير
// للنسخة الأصلية (push.ts) ولا نستورد expo-notifications. الإذن لا يُطلب بلا لمسة: الزر بـ PushPrompt.web فقط.
import type { MukhdarClient } from '@mukhdar/shared';
import { getWebPush, hasVapidKey, needsInstall, PENDING_DELETE_KEY } from './webPushController';

export const PUSH_TOKEN_KEY = 'mukhdar.pushToken';
export const PUSH_ASKED_KEY = 'mukhdar.pushAsked';
export const PENDING_UNREGISTER_KEY = PENDING_DELETE_KEY;
export const ANDROID_CHANNEL_ID = 'orders';

export function configureNotificationHandler(): void {}

export function getProjectId(): string | null {
  return null;
}

export function canUseRemotePush(): boolean {
  return hasVapidKey() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export type RegisterResult = 'registered' | 'unsupported' | 'denied' | 'pin-required' | 'failed';

export function registerPushToken(
  client: MukhdarClient,
  options: { ask: boolean },
): Promise<RegisterResult> {
  return getWebPush().register(client, options);
}

/** قبل الخروج: حذف صف الاشتراك ثم unsubscribe (بلا شبكة: حذف مؤجَّل يُعاد بأول جلسة). لا يرمي. */
export function unregisterPushToken(client: MukhdarClient): Promise<void> {
  return getWebPush().remove(client);
}

/** يُعيد حذف اشتراك خرج صاحبه بلا اتصال (أول جلسة). */
export function retryPendingPushUnregister(client: MukhdarClient): Promise<void> {
  return getWebPush().retryPending(client);
}

/**
 * بعد أول طلب ناجح: إن كان الإذن ممنوحاً مسبقاً نسجّل بصمت. السؤال نفسه بطاقة PushPrompt بصفحة الطلب (لمسة مستخدم)،
 * لا هنا.
 */
export async function askAfterFirstOrder(client: MukhdarClient): Promise<void> {
  if (!canUseRemotePush() || needsInstall()) return;
  if ((await getWebPush().getState(false)) === 'granted-unregistered') {
    await registerPushToken(client, { ask: false });
  }
}
