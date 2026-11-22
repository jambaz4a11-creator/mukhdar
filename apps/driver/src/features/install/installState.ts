// بوابة التثبيت (T37، SPEC-webpush §3.2–3.3). دالة نقية تُختبر بلا متصفح.
// على iOS تخزين الـ PWA المثبَّت منفصل عن Safari، وإشعارات الويب تعمل فقط للمثبَّت (16.4+)، لذلك التسجيل والدخول
// لا يجريان إلا داخل التطبيق المثبَّت: ios-browser وunsupported-ios تحجبان التطبيق.
// كشف iOS ونسخته من @mukhdar/shared (iosInstall.ts، R3 L6: نفس الكشف بتطبيق الزبون).
import { iosVersion, isIosDevice } from '@mukhdar/shared';

export { iosVersion };

export type InstallState =
  'standalone' | 'ios-browser' | 'android-installable' | 'other-browser' | 'unsupported-ios';

export interface InstallEnv {
  /** Platform.OS */
  platform: string;
  userAgent: string;
  /** navigator.standalone (Safari iOS فقط) */
  navigatorStandalone: boolean;
  /** matchMedia('(display-mode: standalone)').matches */
  displayModeStandalone: boolean;
  maxTouchPoints: number;
  /** حدث beforeinstallprompt وصل ولم يُستعمل بعد (Android Chrome) */
  installPromptAvailable: boolean;
}

const MIN_IOS: [number, number] = [16, 4];

function isIOS(env: InstallEnv): boolean {
  return isIosDevice(env.userAgent, env.maxTouchPoints);
}

function below(v: [number, number], min: [number, number]): boolean {
  return v[0] < min[0] || (v[0] === min[0] && v[1] < min[1]);
}

export function installState(env: InstallEnv): InstallState {
  if (env.platform !== 'web') return 'standalone';
  const standalone = env.navigatorStandalone || env.displayModeStandalone;
  if (isIOS(env)) {
    const v = iosVersion(env.userAgent);
    // نسخة غير معروفة ← لا نحجب كـ "قديم" (أفضل جهد)
    if (v && below(v, MIN_IOS)) return 'unsupported-ios';
    return standalone ? 'standalone' : 'ios-browser';
  }
  if (standalone) return 'standalone';
  return env.installPromptAvailable ? 'android-installable' : 'other-browser';
}

/** الحالتان اللتان تحجبان التسجيل والدخول (شاشة كاملة). */
export function blocksApp(state: InstallState): boolean {
  return state === 'ios-browser' || state === 'unsupported-ios';
}
