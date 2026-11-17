// الويب (PWA): لا إشعارات بالنسخة التجريبية، ولا نستورد expo-notifications أصلاً (يطبع تحذيرات ولا يدعم الإشعارات البعيدة هنا).
// نفس أسماء التصدير للنسخة الأصلية (push.ts)، وكلها بلا أثر.
export const PUSH_TOKEN_KEY = 'mukhdar.pushToken';
export const PUSH_ASKED_KEY = 'mukhdar.pushAsked';
export const ANDROID_CHANNEL_ID = 'orders';

export function configureNotificationHandler(): void {}

export function getProjectId(): string | null {
  return null;
}

export function canUseRemotePush(): boolean {
  return false;
}

export type RegisterResult = 'registered' | 'unsupported' | 'denied' | 'failed';

export function registerPushToken(): Promise<RegisterResult> {
  return Promise.resolve('unsupported');
}

export function unregisterPushToken(): Promise<void> {
  return Promise.resolve();
}

export function askAfterFirstOrder(): Promise<void> {
  return Promise.resolve();
}
