// مصدر حالة التثبيت من المتصفح (T37). على الأصلي: دائماً standalone (لا بوابة على الـ APK).
// beforeinstallprompt (Android Chrome) يُلتقط ويُؤجَّل حتى يضغط السائق "ثبّت التطبيق" (لمسة مستخدم).
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { type InstallEnv, type InstallState, installState } from './installState';

interface BrowserLike {
  navigator?: { userAgent?: string; standalone?: boolean; maxTouchPoints?: number };
  matchMedia?: (query: string) => { matches: boolean };
}

export function readInstallEnv(
  platform: string,
  win: BrowserLike | undefined,
  installPromptAvailable: boolean,
): InstallEnv {
  const nav = win?.navigator;
  let displayModeStandalone: boolean;
  try {
    displayModeStandalone = win?.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    displayModeStandalone = false;
  }
  return {
    platform,
    userAgent: nav?.userAgent ?? '',
    navigatorStandalone: nav?.standalone === true,
    displayModeStandalone,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    installPromptAvailable,
  };
}

interface DeferredPrompt {
  preventDefault(): void;
  prompt(): Promise<void>;
}

interface EventTargetLike {
  addEventListener(type: string, fn: (e: unknown) => void): void;
  removeEventListener(type: string, fn: (e: unknown) => void): void;
}

/** يلتقط beforeinstallprompt. onChange(true) = يمكن عرض "ثبّت التطبيق". الحدث يُستعمل مرة واحدة. */
export function subscribeInstallPrompt(
  win: EventTargetLike,
  onChange: (available: boolean) => void,
): { prompt(): Promise<void>; unsubscribe(): void } {
  let deferred: DeferredPrompt | null = null;
  const onPrompt = (e: unknown) => {
    deferred = e as DeferredPrompt;
    deferred.preventDefault(); // لا شريط المتصفح التلقائي: نعرض شريطنا
    onChange(true);
  };
  const onInstalled = () => {
    deferred = null;
    onChange(false);
  };
  win.addEventListener('beforeinstallprompt', onPrompt);
  win.addEventListener('appinstalled', onInstalled);
  return {
    async prompt() {
      const event = deferred;
      if (!event) return;
      deferred = null;
      onChange(false);
      try {
        await event.prompt();
      } catch {
        // رفض المتصفح (مثلاً بلا لمسة): لا شيء
      }
    },
    unsubscribe() {
      win.removeEventListener('beforeinstallprompt', onPrompt);
      win.removeEventListener('appinstalled', onInstalled);
    },
  };
}

export function useInstallState(): {
  state: InstallState;
  promptInstall: () => Promise<void>;
  dismissBanner: () => void;
} {
  const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
  const [promptAvailable, setPromptAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [handle, setHandle] = useState<ReturnType<typeof subscribeInstallPrompt> | null>(null);

  useEffect(() => {
    if (!isWeb) return undefined;
    const h = subscribeInstallPrompt(window as unknown as EventTargetLike, setPromptAvailable);
    setHandle(h);
    return () => h.unsubscribe();
  }, [isWeb]);

  const state = useMemo(
    () =>
      installState(
        readInstallEnv(
          Platform.OS,
          isWeb ? (window as unknown as BrowserLike) : undefined,
          promptAvailable && !dismissed,
        ),
      ),
    [isWeb, promptAvailable, dismissed],
  );

  return {
    state,
    promptInstall: () => handle?.prompt() ?? Promise.resolve(),
    dismissBanner: () => setDismissed(true),
  };
}
