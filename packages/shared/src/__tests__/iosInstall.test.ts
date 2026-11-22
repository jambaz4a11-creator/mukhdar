import { iosNeedsInstall, iosVersion, isIosDevice, readBrowserInstallEnv } from '../iosInstall';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('iosInstall (R3 L6: one detector for both apps)', () => {
  it('isIosDevice: iPhone, iPadOS-as-Mac with touch; not a real Mac, not Android', () => {
    expect(isIosDevice(IPHONE, 5)).toBe(true);
    expect(isIosDevice(IPAD_DESKTOP, 5)).toBe(true);
    expect(isIosDevice(IPAD_DESKTOP, 0)).toBe(false);
    expect(isIosDevice(ANDROID, 5)).toBe(false);
  });

  it('iosVersion from "OS 17_5" or "Version/16.4"', () => {
    expect(iosVersion(IPHONE)).toEqual([17, 5]);
    expect(iosVersion(IPAD_DESKTOP)).toEqual([16, 4]);
    expect(iosVersion(ANDROID)).toBeNull();
  });

  it('iosNeedsInstall: iOS tab yes; installed (standalone or display-mode) no; Android no', () => {
    const win = (ua: string, standalone: boolean, displayMode: boolean) => ({
      navigator: { userAgent: ua, standalone, maxTouchPoints: 5 },
      matchMedia: () => ({ matches: displayMode }),
    });
    expect(iosNeedsInstall(readBrowserInstallEnv(win(IPHONE, false, false)))).toBe(true);
    expect(iosNeedsInstall(readBrowserInstallEnv(win(IPHONE, true, false)))).toBe(false);
    expect(iosNeedsInstall(readBrowserInstallEnv(win(IPHONE, false, true)))).toBe(false);
    expect(iosNeedsInstall(readBrowserInstallEnv(win(ANDROID, false, false)))).toBe(false);
  });

  it('readBrowserInstallEnv survives no window and a throwing matchMedia', () => {
    expect(readBrowserInstallEnv(undefined)).toEqual({
      userAgent: '',
      maxTouchPoints: 0,
      standalone: false,
    });
    const env = readBrowserInstallEnv({
      navigator: { userAgent: IPHONE },
      matchMedia: () => {
        throw new Error('x');
      },
    });
    expect(env.standalone).toBe(false);
  });
});
