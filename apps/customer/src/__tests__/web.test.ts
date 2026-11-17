// طبقة الويب (PWA): تخزين الجلسة، نوافذ التأكيد، RTL، وبدائل الإشعارات (ملفات *.web.ts تُختبر مباشرة).
import { webAlert } from '../lib/webShims.web';
import { secureStorage } from '../lib/secureStorage.web';
import { ensureRTL } from '../lib/rtl.web';
import * as push from '../features/notifications/push.web';

const g = globalThis as unknown as Record<string, unknown>;

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('web secureStorage (localStorage)', () => {
  afterEach(() => {
    delete g.localStorage;
  });

  it('round-trips a big session value without chunking', async () => {
    g.localStorage = fakeStorage();
    const big = 'x'.repeat(10_000);
    await secureStorage.setItem('sb-x-auth-token', big);
    expect(await secureStorage.getItem('sb-x-auth-token')).toBe(big);
    await secureStorage.removeItem('sb-x-auth-token');
    expect(await secureStorage.getItem('sb-x-auth-token')).toBeNull();
  });

  it('does not crash when storage is missing or throws', async () => {
    await expect(secureStorage.getItem('k')).resolves.toBeNull();
    await expect(secureStorage.setItem('k', 'v')).resolves.toBeUndefined();
    g.localStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    await expect(secureStorage.getItem('k')).resolves.toBeNull();
    await expect(secureStorage.setItem('k', 'v')).resolves.toBeUndefined();
    await expect(secureStorage.removeItem('k')).resolves.toBeUndefined();
  });
});

describe('webAlert', () => {
  const alertFn = jest.fn();
  const confirmFn = jest.fn();
  beforeEach(() => {
    g.window = { alert: alertFn, confirm: confirmFn };
    alertFn.mockReset();
    confirmFn.mockReset();
  });
  afterEach(() => {
    delete g.window;
  });

  it('single button: plain alert then its handler', () => {
    const ok = jest.fn();
    webAlert('عنوان', 'نص', [{ text: 'تمام', onPress: ok }]);
    expect(alertFn).toHaveBeenCalledWith('عنوان\n\nنص');
    expect(ok).toHaveBeenCalled();
  });

  it('cancel/confirm pair: OK runs the destructive button, Cancel runs the cancel button', () => {
    const cancel = jest.fn();
    const del = jest.fn();
    const buttons = [
      { text: 'إلغاء', style: 'cancel' as const, onPress: cancel },
      { text: 'حذف', style: 'destructive' as const, onPress: del },
    ];
    confirmFn.mockReturnValueOnce(true);
    webAlert('حذف؟', undefined, buttons);
    expect(del).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    confirmFn.mockReturnValueOnce(false);
    webAlert('حذف؟', undefined, buttons);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
  });
});

describe('web rtl + push stubs', () => {
  it('ensureRTL sets dir/lang on <html> and never reloads', async () => {
    const root = { dir: 'ltr', lang: 'en' };
    g.document = { documentElement: root };
    await expect(ensureRTL()).resolves.toBe('ok');
    expect(root).toEqual({ dir: 'rtl', lang: 'ar' });
    delete g.document;
  });

  it('push is inert on web', async () => {
    expect(push.canUseRemotePush()).toBe(false);
    expect(push.getProjectId()).toBeNull();
    expect(() => push.configureNotificationHandler()).not.toThrow();
    await expect(push.registerPushToken()).resolves.toBe('unsupported');
    await expect(push.askAfterFirstOrder()).resolves.toBeUndefined();
    await expect(push.unregisterPushToken()).resolves.toBeUndefined();
  });
});
