// طبقة الويب (PWA): تخزين الجلسة، نوافذ التأكيد، RTL، وبدائل الإشعارات (ملفات *.web.ts تُختبر مباشرة).
import { MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { IDBFactory } from 'fake-indexeddb';
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

// T34: IndexedDB مشفَّر (createWebSecureStorage من @mukhdar/shared) بدل localStorage الصريح، مع ترحيل لمرة واحدة.
describe('web secureStorage (encrypted IndexedDB, T34)', () => {
  const KEY = 'sb-ghcohlrzvehtcettaaiu-auth-token';
  const SESSION = JSON.stringify({ access_token: 'a.b.c', refresh_token: 'refresh-plain-xyz' });

  /** تحميل جديد للوحدة = إعادة تحميل الصفحة (نفس IndexedDB ونفس localStorage). */
  function loadPage(): typeof import('../lib/secureStorage.web') {
    let mod!: typeof import('../lib/secureStorage.web');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../lib/secureStorage.web');
    });
    return mod;
  }

  // jest-expo يضع structuredClone بديلاً (serialize/deserialize) يحوّل CryptoKey إلى {}؛ المتصفح وNode ينسخانه.
  // fake-indexeddb ينسخ بـ structuredClone العام، فنعطيه نسخ Node الحقيقي (MessagePort متزامن).
  const envClone = g.structuredClone;
  function nodeStructuredClone(value: unknown) {
    const { port1, port2 } = new MessageChannel();
    try {
      port1.postMessage(value);
      return receiveMessageOnPort(port2)?.message;
    } finally {
      port1.close();
      port2.close();
    }
  }

  beforeEach(() => {
    g.structuredClone = nodeStructuredClone;
    g.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    g.structuredClone = envClone;
    delete g.localStorage;
    delete g.indexedDB;
  });

  it('round-trips a big session; nothing lands in localStorage; survives a reload', async () => {
    const ls = fakeStorage();
    g.localStorage = ls;
    const big = SESSION + 'x'.repeat(10_000);
    await secureStorage.setItem(KEY, big);
    expect(await secureStorage.getItem(KEY)).toBe(big);
    expect(ls.getItem(KEY)).toBeNull();
    expect(await loadPage().secureStorage.getItem(KEY)).toBe(big);
    await secureStorage.removeItem(KEY);
    expect(await loadPage().secureStorage.getItem(KEY)).toBeNull();
  });

  it('migrates an existing plain localStorage session once, then no plain copy remains', async () => {
    const ls = fakeStorage();
    ls.setItem(KEY, SESSION);
    g.localStorage = ls;
    const page = loadPage();
    expect(await page.secureStorage.getItem(KEY)).toBe(SESSION);
    expect(ls.getItem(KEY)).toBeNull();
    expect(await loadPage().secureStorage.getItem(KEY)).toBe(SESSION); // من IndexedDB بعد الترحيل
    expect(page.isSessionStorageDegraded()).toBe(false);
  });

  it('no IndexedDB (private mode): memory only, flagged degraded, plain copy still removed', async () => {
    delete g.indexedDB;
    const ls = fakeStorage();
    ls.setItem(KEY, SESSION);
    g.localStorage = ls;
    const page = loadPage();
    expect(await page.secureStorage.getItem(KEY)).toBe(SESSION);
    expect(ls.getItem(KEY)).toBeNull();
    expect(page.isSessionStorageDegraded()).toBe(true);
  });

  it('does not crash when localStorage is missing or throws', async () => {
    const page = loadPage();
    await expect(page.secureStorage.getItem('k')).resolves.toBeNull();
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
    await expect(page.secureStorage.getItem('k2')).resolves.toBeNull();
    await expect(page.secureStorage.setItem('k', 'v')).resolves.toBeUndefined();
    await expect(page.secureStorage.getItem('k')).resolves.toBe('v');
    await expect(page.secureStorage.removeItem('k')).resolves.toBeUndefined();
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

  it('push is inert without a VAPID public key (T38: no key at build time = no Web Push)', async () => {
    const client = {} as never;
    expect(push.canUseRemotePush()).toBe(false);
    expect(push.getProjectId()).toBeNull();
    expect(() => push.configureNotificationHandler()).not.toThrow();
    await expect(push.registerPushToken(client, { ask: true })).resolves.toBe('unsupported');
    await expect(push.askAfterFirstOrder(client)).resolves.toBeUndefined();
    await expect(push.unregisterPushToken(client)).resolves.toBeUndefined();
  });
});
