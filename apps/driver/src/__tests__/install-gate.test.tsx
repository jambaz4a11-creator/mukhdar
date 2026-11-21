// شاشة بوابة التثبيت وشريط Android (T37، SPEC-webpush §3.3)، ومصدر الحالة من المتصفح.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { InstallGate } from '../features/install/InstallGate';
import { readInstallEnv, subscribeInstallPrompt } from '../features/install/useInstallState';
import { ar } from '../i18n/ar';
import { renderScreen } from '../test-utils/render';

describe('InstallGate', () => {
  it('ios-browser: full-screen install steps, nothing behind is reachable', async () => {
    await renderScreen(<InstallGate state="ios-browser" />);
    expect(screen.getByTestId('install-gate')).toBeTruthy();
    for (const text of [
      ar.install.iosTitle,
      ar.install.iosBody,
      ar.install.iosStep1,
      ar.install.iosStep2,
      ar.install.iosStep3,
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.queryByTestId('install-banner')).toBeNull();
  });

  it('unsupported-ios: update message, no install steps', async () => {
    await renderScreen(<InstallGate state="unsupported-ios" />);
    expect(screen.getByTestId('install-gate')).toBeTruthy();
    expect(screen.getByText(ar.install.unsupportedBody)).toBeTruthy();
    expect(screen.queryByText(ar.install.iosStep1)).toBeNull();
  });

  it('android-installable: optional banner (no blocking); install and dismiss', async () => {
    const onInstall = jest.fn();
    const onDismiss = jest.fn();
    await renderScreen(
      <InstallGate state="android-installable" onInstall={onInstall} onDismiss={onDismiss} />,
    );
    expect(screen.queryByTestId('install-gate')).toBeNull();
    expect(screen.getByText(ar.install.androidBanner)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('install-banner-install'));
    expect(onInstall).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('install-banner-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('standalone and other browsers: renders nothing', async () => {
    for (const state of ['standalone', 'other-browser'] as const) {
      const view = await renderScreen(<InstallGate state={state} />);
      expect(screen.queryByTestId('install-gate')).toBeNull();
      expect(screen.queryByTestId('install-banner')).toBeNull();
      await view.unmount();
    }
  });
});

describe('readInstallEnv', () => {
  it('reads navigator.standalone, display-mode and touch points from the browser', () => {
    const win = {
      navigator: { userAgent: 'UA', standalone: true, maxTouchPoints: 5 },
      matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }),
    };
    expect(readInstallEnv('web', win as never, true)).toEqual({
      platform: 'web',
      userAgent: 'UA',
      navigatorStandalone: true,
      displayModeStandalone: true,
      maxTouchPoints: 5,
      installPromptAvailable: true,
    });
  });

  it('missing APIs (no window, no matchMedia) are treated as false, never thrown', () => {
    expect(readInstallEnv('ios', undefined, false).platform).toBe('ios');
    const env = readInstallEnv('web', { navigator: { userAgent: 'x' } } as never, false);
    expect(env.displayModeStandalone).toBe(false);
    expect(env.navigatorStandalone).toBe(false);
    expect(env.maxTouchPoints).toBe(0);
  });
});

describe('subscribeInstallPrompt', () => {
  it('captures beforeinstallprompt (preventDefault) and replays prompt() on demand', async () => {
    const listeners = new Map<string, (e: unknown) => void>();
    const win = {
      addEventListener: (t: string, fn: (e: unknown) => void) => listeners.set(t, fn),
      removeEventListener: (t: string) => listeners.delete(t),
    };
    const onChange = jest.fn();
    const handle = subscribeInstallPrompt(win as never, onChange);
    const event = {
      preventDefault: jest.fn(),
      prompt: jest.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    };
    await act(async () => listeners.get('beforeinstallprompt')?.(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(true);

    await handle.prompt();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(false); // used once only

    await act(async () => listeners.get('appinstalled')?.({}));
    handle.unsubscribe();
    expect(listeners.size).toBe(0);
  });

  it('prompt() without a captured event is a no-op', async () => {
    const handle = subscribeInstallPrompt(
      { addEventListener: () => {}, removeEventListener: () => {} } as never,
      () => {},
    );
    await expect(handle.prompt()).resolves.toBeUndefined();
  });
});
