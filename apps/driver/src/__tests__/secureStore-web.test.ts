// T34 (تجهيز لـ T37/W4): نسختا الويب للجلسة وطلب التسجيل فوق التخزين المشفَّر (@mukhdar/shared)،
// بنفس واجهة النسخ الأصلية. تُختبر مباشرة (ملفات *.web.ts)؛ الربط الفعلي بتصدير الويب بـ T37.
import { MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { IDBFactory } from 'fake-indexeddb';

const g = globalThis as unknown as Record<string, unknown>;
const SECRET = 'a'.repeat(43);

// jest-expo: structuredClone بديل يحوّل CryptoKey إلى {} (المتصفح ينسخه). نسخ Node الحقيقي لـ fake-indexeddb.
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

type StoreModule = typeof import('../lib/secureStore.web');
type StorageModule = typeof import('../lib/secureStorage.web');

/** تحميل جديد للوحدتين = إعادة تحميل الصفحة (نفس IndexedDB). */
function loadPage(): { store: StoreModule; storage: StorageModule } {
  let out!: { store: StoreModule; storage: StorageModule };
  jest.isolateModules(() => {
    out = {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      store: require('../lib/secureStore.web'),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      storage: require('../lib/secureStorage.web'),
    };
  });
  return out;
}

beforeEach(() => {
  g.structuredClone = nodeStructuredClone;
  g.indexedDB = new IDBFactory();
});
afterEach(() => {
  g.structuredClone = envClone;
  delete g.indexedDB;
});

it('registration: needs both request id and secret; survives a reload; clear wipes all', async () => {
  const { store } = loadPage();
  expect(await store.loadRegistration()).toBeNull();
  await store.saveSecret(SECRET);
  expect(await store.readSecret()).toBe(SECRET);
  expect(await store.loadRegistration()).toBeNull();
  await store.saveRegistration({ requestId: 'r1', fullName: 'علي حسين', phone: '+9647801112222' });
  const expected = {
    requestId: 'r1',
    secret: SECRET,
    fullName: 'علي حسين',
    phone: '+9647801112222',
  };
  expect(await store.loadRegistration()).toEqual(expected);
  expect(await loadPage().store.loadRegistration()).toEqual(expected);
  await store.clearRegistration();
  const after = loadPage().store;
  expect(await after.loadRegistration()).toBeNull();
  expect(await after.readSecret()).toBeNull();
});

it('the secret is never stored in plain text (IndexedDB holds only {iv, ct})', async () => {
  const { store } = loadPage();
  await store.saveSecret(SECRET);
  const idb = g.indexedDB as IDBFactory;
  const records = await new Promise<unknown[]>((resolve, reject) => {
    const r = idb.open('mukhdar-secure');
    r.onsuccess = () => {
      const req = r.result.transaction('items').objectStore('items').getAll();
      req.onsuccess = () => {
        r.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    };
    r.onerror = () => reject(r.error);
  });
  expect(records).toHaveLength(1);
  const rec = records[0] as { iv: Uint8Array; ct: ArrayBuffer };
  expect(Object.keys(rec).sort()).toEqual(['ct', 'iv']);
  expect(Buffer.from(new Uint8Array(rec.ct)).toString('latin1')).not.toContain('aaaaaaaa');
});

it('session storage round-trips and exposes the degraded flag', async () => {
  const { storage } = loadPage();
  await storage.secureStorage.setItem('sb-x-auth-token', '{"refresh_token":"r"}');
  expect(await loadPage().storage.secureStorage.getItem('sb-x-auth-token')).toBe(
    '{"refresh_token":"r"}',
  );
  expect(storage.isSessionStorageDegraded()).toBe(false);
});

it('no IndexedDB: memory only, degraded, no crash', async () => {
  delete g.indexedDB;
  const { store, storage } = loadPage();
  await store.saveSecret(SECRET);
  expect(await store.readSecret()).toBe(SECRET);
  expect(storage.isSessionStorageDegraded()).toBe(true);
});
