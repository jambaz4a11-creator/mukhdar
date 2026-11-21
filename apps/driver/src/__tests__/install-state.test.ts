// بوابة التثبيت (T37، SPEC-webpush §3.3): installState() دالة نقية لكل حالة ووكيل مستخدم.
import {
  blocksApp,
  installState,
  iosVersion,
  type InstallEnv,
} from '../features/install/installState';

const UA = {
  iphone17:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphone164:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
  iphone163:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iphone15:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  ipadOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  ipadOsOld:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const web = (over: Partial<InstallEnv>): InstallEnv => ({
  platform: 'web',
  userAgent: UA.desktopChrome,
  navigatorStandalone: false,
  displayModeStandalone: false,
  maxTouchPoints: 0,
  installPromptAvailable: false,
  ...over,
});

describe('installState', () => {
  it('native builds are always "standalone" (no gate on the APK)', () => {
    expect(installState({ ...web({ userAgent: UA.iphone15 }), platform: 'ios' })).toBe(
      'standalone',
    );
    expect(installState({ ...web({}), platform: 'android' })).toBe('standalone');
  });

  it('iPhone Safari tab (16.4+) → ios-browser', () => {
    expect(installState(web({ userAgent: UA.iphone17, maxTouchPoints: 5 }))).toBe('ios-browser');
    expect(installState(web({ userAgent: UA.iphone164, maxTouchPoints: 5 }))).toBe('ios-browser');
  });

  it('other iOS browsers (Chrome on iPhone) are also ios-browser: install from Safari', () => {
    expect(installState(web({ userAgent: UA.iphoneChrome, maxTouchPoints: 5 }))).toBe(
      'ios-browser',
    );
  });

  it('installed on iPhone (navigator.standalone or display-mode) → standalone', () => {
    expect(installState(web({ userAgent: UA.iphone17, navigatorStandalone: true }))).toBe(
      'standalone',
    );
    expect(installState(web({ userAgent: UA.iphone17, displayModeStandalone: true }))).toBe(
      'standalone',
    );
  });

  it('iOS below 16.4 → unsupported-ios, even when installed', () => {
    expect(installState(web({ userAgent: UA.iphone163, maxTouchPoints: 5 }))).toBe(
      'unsupported-ios',
    );
    expect(installState(web({ userAgent: UA.iphone15, navigatorStandalone: true }))).toBe(
      'unsupported-ios',
    );
  });

  it('iPadOS with a desktop user agent is detected by touch points', () => {
    expect(installState(web({ userAgent: UA.ipadOs, maxTouchPoints: 5 }))).toBe('ios-browser');
    expect(installState(web({ userAgent: UA.ipadOsOld, maxTouchPoints: 5 }))).toBe(
      'unsupported-ios',
    );
  });

  it('a real Mac (no touch) is a normal browser', () => {
    expect(installState(web({ userAgent: UA.macSafari, maxTouchPoints: 0 }))).toBe('other-browser');
  });

  it('Android Chrome: android-installable once beforeinstallprompt fired, else other-browser', () => {
    expect(installState(web({ userAgent: UA.android, installPromptAvailable: true }))).toBe(
      'android-installable',
    );
    expect(installState(web({ userAgent: UA.android }))).toBe('other-browser');
    expect(installState(web({ userAgent: UA.android, displayModeStandalone: true }))).toBe(
      'standalone',
    );
  });

  it('desktop browsers are other-browser (useful for testing)', () => {
    expect(installState(web({}))).toBe('other-browser');
  });
});

describe('iosVersion', () => {
  it('reads "OS 17_5" from iPhone and "Version/17.4" from iPadOS', () => {
    expect(iosVersion(UA.iphone17)).toEqual([17, 5]);
    expect(iosVersion(UA.iphone163)).toEqual([16, 3]);
    expect(iosVersion(UA.ipadOs)).toEqual([17, 4]);
    expect(iosVersion('weird agent')).toBeNull();
  });

  it('unknown iOS version is not blocked as unsupported (best effort)', () => {
    expect(installState(web({ userAgent: 'Mozilla/5.0 (iPhone)', maxTouchPoints: 5 }))).toBe(
      'ios-browser',
    );
  });
});

describe('blocksApp', () => {
  it('only the two iOS states block sign-in / registration', () => {
    expect(blocksApp('ios-browser')).toBe(true);
    expect(blocksApp('unsupported-ios')).toBe(true);
    expect(blocksApp('standalone')).toBe(false);
    expect(blocksApp('android-installable')).toBe(false);
    expect(blocksApp('other-browser')).toBe(false);
  });
});
