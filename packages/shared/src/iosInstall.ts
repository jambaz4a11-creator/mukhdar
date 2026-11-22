// كشف iOS لبوابة التثبيت وإشعارات الويب (R3 L6): مصدر واحد للسائق (installState) والزبون (needsInstall).
// على iOS إشعارات الويب والتخزين الدائم للتطبيق المثبَّت فقط (SPEC-webpush §3.2). دوال نقية، لا API عند الاستيراد.

/** iPhone/iPad/iPod، أو iPadOS 13+ الذي يقدّم نفسه كـ Mac سطح مكتب (الفرق شاشة اللمس). */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** [major, minor] من "OS 17_5" (iPhone) أو "Version/17.4" (iPadOS بوكيل سطح المكتب)، وإلا null. */
export function iosVersion(userAgent: string): [number, number] | null {
  const m = /OS (\d+)_(\d+)/.exec(userAgent) ?? /Version\/(\d+)\.(\d+)/.exec(userAgent);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export interface BrowserInstallEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** navigator.standalone (Safari iOS) أو display-mode: standalone */
  standalone: boolean;
}

interface BrowserLike {
  navigator?: { userAgent?: string; standalone?: boolean; maxTouchPoints?: number };
  matchMedia?: (query: string) => { matches: boolean };
}

/** يقرأ ما يلزم من window (أو لا شيء خارج المتصفح). */
export function readBrowserInstallEnv(win: BrowserLike | undefined): BrowserInstallEnv {
  const nav = win?.navigator;
  let displayMode = false;
  try {
    displayMode = win?.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    displayMode = false;
  }
  return {
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone: nav?.standalone === true || displayMode,
  };
}

/** iOS خارج التطبيق المثبَّت: الإشعارات تحتاج "إضافة إلى الشاشة الرئيسية" أولاً. */
export function iosNeedsInstall(env: BrowserInstallEnv): boolean {
  return isIosDevice(env.userAgent, env.maxTouchPoints) && !env.standalone;
}
