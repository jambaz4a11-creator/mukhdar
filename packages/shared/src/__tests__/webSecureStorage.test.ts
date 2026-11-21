// التخزين المشفَّر للويب (T34، SPEC-webpush §6): IndexedDB (fake-indexeddb) + WebCrypto (Node).
import { IDBFactory } from 'fake-indexeddb';
import {
  WEB_SECURE_DB,
  WEB_SECURE_ITEMS,
  WEB_SECURE_KEYS,
  createWebSecureStorage,
  type LegacyStore,
} from '../webSecureStorage';

const SESSION = JSON.stringify({
  access_token: 'eyJhbGciOiJIUzI1NiJ9.payload-access-token-value.signature',
  refresh_token: 'refresh-token-abcdefghijkl',
  user: { id: '6f1c2c1e-1111-4222-8333-444455556666', phone: '9647801112222' },
});
const KEY = 'sb-ghcohlrzvehtcettaaiu-auth-token';

let idb: IDBFactory;
beforeEach(() => {
  idb = new IDBFactory(); // قاعدة جديدة لكل اختبار
});

const make = (extra: Parameters<typeof createWebSecureStorage>[0] = {}) =>
  createWebSecureStorage({ indexedDB: idb, persist: async () => true, ...extra });

// ---- وصول مباشر للقاعدة (كما يراها DevTools أو نسخة قرص) ----
function openRaw(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = idb.open(WEB_SECURE_DB);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function raw(store: string, op: 'get' | 'delete' | 'put', key: string, value?: unknown) {
  const db = await openRaw();
  try {
    return await new Promise<unknown>((res, rej) => {
      const tx = db.transaction(store, op === 'get' ? 'readonly' : 'readwrite');
      const s = tx.objectStore(store);
      const r = op === 'get' ? s.get(key) : op === 'delete' ? s.delete(key) : s.put(value, key);
      let out: unknown;
      r.onsuccess = () => (out = r.result);
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
    });
  } finally {
    db.close();
  }
}

function memoryLegacy(init: Record<string, string> = {}): LegacyStore & { m: Map<string, string> } {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => m.get(k) ?? null,
    removeItem: (k) => void m.delete(k),
  };
}

describe('encrypted round-trip', () => {
  it('stores, reads back and removes a big session (no chunking)', async () => {
    const s = make();
    const big = SESSION + 'x'.repeat(10_000);
    await s.setItem(KEY, big);
    expect(await s.getItem(KEY)).toBe(big);
    await s.removeItem(KEY);
    expect(await s.getItem(KEY)).toBeNull();
    expect(await raw(WEB_SECURE_ITEMS, 'get', KEY)).toBeUndefined();
    expect(s.isDegraded()).toBe(false);
  });

  it('an unknown key is null', async () => {
    expect(await make().getItem('nothing')).toBeNull();
  });

  it('the stored record is {iv, ct}: 12-byte IV, ciphertext ≠ plaintext and holds no piece of it', async () => {
    await make().setItem(KEY, SESSION);
    const rec = (await raw(WEB_SECURE_ITEMS, 'get', KEY)) as { iv: Uint8Array; ct: ArrayBuffer };
    expect(Object.keys(rec).sort()).toEqual(['ct', 'iv']);
    expect(new Uint8Array(rec.iv).byteLength).toBe(12);
    const bytes = Buffer.from(new Uint8Array(rec.ct));
    for (const enc of ['utf8', 'latin1', 'base64'] as const) {
      const text = bytes.toString(enc);
      expect(text).not.toBe(SESSION);
      for (let i = 0; i + 8 <= SESSION.length; i++) {
        expect(text.includes(SESSION.slice(i, i + 8))).toBe(false);
      }
    }
    // ولا شيء نصي بأي مكان بالقاعدة: السجل كله بلا مقطع من الرمز
    expect(JSON.stringify(rec)).not.toContain('refresh-token');
  });

  it('a fresh IV (and ciphertext) on every write, even for the same value', async () => {
    const s = make();
    await s.setItem(KEY, SESSION);
    const a = (await raw(WEB_SECURE_ITEMS, 'get', KEY)) as { iv: Uint8Array; ct: ArrayBuffer };
    await s.setItem(KEY, SESSION);
    const b = (await raw(WEB_SECURE_ITEMS, 'get', KEY)) as { iv: Uint8Array; ct: ArrayBuffer };
    expect(Buffer.from(new Uint8Array(a.iv)).equals(Buffer.from(new Uint8Array(b.iv)))).toBe(false);
    expect(Buffer.from(new Uint8Array(a.ct)).equals(Buffer.from(new Uint8Array(b.ct)))).toBe(false);
    expect(await s.getItem(KEY)).toBe(SESSION);
  });

  it('a record copied under another key does not decrypt (key name is bound as AAD)', async () => {
    const s = make();
    await s.setItem('a', 'secret-a');
    await raw(WEB_SECURE_ITEMS, 'put', 'b', await raw(WEB_SECURE_ITEMS, 'get', 'a'));
    expect(await s.getItem('b')).toBeNull();
    expect(await s.getItem('a')).toBe('secret-a');
  });
});

describe('the key', () => {
  it('is a non-extractable AES-GCM CryptoKey object in IndexedDB; exportKey fails', async () => {
    await make().setItem(KEY, SESSION);
    const key = (await raw(WEB_SECURE_KEYS, 'get', 'aes-gcm-v1')) as CryptoKey;
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt']);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', key)).rejects.toThrow();
  });

  it('survives a reload (new instance, same database)', async () => {
    await make().setItem(KEY, SESSION);
    expect(await raw(WEB_SECURE_KEYS, 'get', 'aes-gcm-v1')).toBeDefined();
    const reloaded = make();
    // يفك ما كتبته النسخة السابقة = نفس المفتاح بقي (لا مفتاح جديد يمسح البيانات)
    expect(await reloaded.getItem(KEY)).toBe(SESSION);
  });

  it('two tabs starting together end up with one key (each reads the other)', async () => {
    const a = make();
    const b = make();
    await Promise.all([a.setItem('ka', 'va'), b.setItem('kb', 'vb')]);
    expect(await make().getItem('ka')).toBe('va');
    expect(await make().getItem('kb')).toBe('vb');
  });
});

describe('failure = "no value", never a throw or a loop', () => {
  it('tampered ciphertext → null and the entry is wiped', async () => {
    const s = make();
    await s.setItem(KEY, SESSION);
    const rec = (await raw(WEB_SECURE_ITEMS, 'get', KEY)) as { iv: Uint8Array; ct: ArrayBuffer };
    const ct = new Uint8Array(rec.ct.slice(0));
    ct[0] = (ct[0] as number) ^ 0xff;
    await raw(WEB_SECURE_ITEMS, 'put', KEY, { iv: rec.iv, ct: ct.buffer });
    expect(await s.getItem(KEY)).toBeNull();
    expect(await raw(WEB_SECURE_ITEMS, 'get', KEY)).toBeUndefined();
    expect(await s.getItem(KEY)).toBeNull();
  });

  it('a malformed record (not {iv, ct}) → null and wiped', async () => {
    const s = make();
    await s.setItem('other', 'x'); // يفتح القاعدة وينشئ المفتاح
    await raw(WEB_SECURE_ITEMS, 'put', KEY, SESSION); // نص صريح دسّه أحد
    expect(await s.getItem(KEY)).toBeNull();
    expect(await raw(WEB_SECURE_ITEMS, 'get', KEY)).toBeUndefined();
  });

  it('key evicted but data left → null after reload, and the stale data is wiped', async () => {
    await make().setItem(KEY, SESSION);
    await raw(WEB_SECURE_KEYS, 'delete', 'aes-gcm-v1');
    const reloaded = make();
    expect(await reloaded.getItem(KEY)).toBeNull();
    expect(await raw(WEB_SECURE_ITEMS, 'get', KEY)).toBeUndefined();
    // ويعمل طبيعياً بعدها بمفتاح جديد
    await reloaded.setItem(KEY, 'new');
    expect(await make().getItem(KEY)).toBe('new');
  });

  it('a different key than the one that wrote the data → null and wiped', async () => {
    await make().setItem(KEY, SESSION);
    const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await raw(WEB_SECURE_KEYS, 'put', 'aes-gcm-v1', other);
    expect(await make().getItem(KEY)).toBeNull();
    expect(await raw(WEB_SECURE_ITEMS, 'get', KEY)).toBeUndefined();
  });
});

describe('degraded: memory only (private mode, no IndexedDB, no WebCrypto)', () => {
  const cases: [string, Parameters<typeof createWebSecureStorage>[0]][] = [
    ['indexedDB missing', { indexedDB: null }],
    [
      'indexedDB.open throws',
      {
        indexedDB: {
          open: () => {
            throw new DOMException('denied', 'SecurityError');
          },
        } as unknown as IDBFactory,
      },
    ],
    [
      'indexedDB.open errors',
      {
        indexedDB: {
          open: () => {
            const r = {} as IDBOpenDBRequest & { onerror: ((e: unknown) => void) | null };
            setTimeout(() => r.onerror?.(new Event('error')), 0);
            return r;
          },
        } as unknown as IDBFactory,
      },
    ],
    [
      'indexedDB.open hangs',
      { indexedDB: { open: () => ({}) } as unknown as IDBFactory, openTimeoutMs: 20 },
    ],
    ['WebCrypto missing', { crypto: null }],
  ];

  it.each(cases)('%s → works in memory, flagged degraded', async (_n, opts) => {
    const s = createWebSecureStorage({ persist: async () => true, ...opts });
    expect(await s.ready()).toEqual({ degraded: true });
    expect(s.isDegraded()).toBe(true);
    await s.setItem(KEY, SESSION);
    expect(await s.getItem(KEY)).toBe(SESSION);
    await s.removeItem(KEY);
    expect(await s.getItem(KEY)).toBeNull();
  });

  it('isDegraded() is false before init and after a healthy init', async () => {
    const s = make();
    expect(s.isDegraded()).toBe(false);
    expect(await s.ready()).toEqual({ degraded: false });
  });
});

describe('navigator.storage.persist() (best effort)', () => {
  it('is asked once at start', async () => {
    const persist = jest.fn(async () => true);
    const s = make({ persist });
    await s.setItem('a', '1');
    await s.getItem('a');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('a refusal or a throw changes nothing', async () => {
    const s = make({
      persist: () => {
        throw new Error('nope');
      },
    });
    await s.setItem('a', '1');
    expect(await s.getItem('a')).toBe('1');
    const t = make({ persist: () => Promise.reject(new Error('nope')) });
    expect(await t.getItem('a')).toBe('1');
  });
});

describe('one-time migration from plain localStorage', () => {
  it('reads the legacy value once, encrypts it, deletes the plain copy', async () => {
    const legacy = memoryLegacy({ [KEY]: SESSION });
    const s = make({ legacy });
    expect(await s.getItem(KEY)).toBe(SESSION);
    expect(legacy.m.has(KEY)).toBe(false);
    const rec = await raw(WEB_SECURE_ITEMS, 'get', KEY);
    expect(JSON.stringify(rec)).not.toContain('refresh-token');
    // بعد إعادة التحميل: من IndexedDB لا من localStorage
    expect(await make({ legacy: memoryLegacy() }).getItem(KEY)).toBe(SESSION);
  });

  it('an encrypted value wins over a stale legacy copy, and the legacy copy is removed on write', async () => {
    const s = make();
    await s.setItem(KEY, 'encrypted');
    const legacy = memoryLegacy({ [KEY]: 'stale-plain' });
    const t = make({ legacy });
    await t.setItem(KEY, 'newer');
    expect(legacy.m.has(KEY)).toBe(false);
    expect(await t.getItem(KEY)).toBe('newer');
  });

  it('removeItem also removes the legacy copy (sign-out leaves nothing plain)', async () => {
    const legacy = memoryLegacy({ [KEY]: SESSION });
    await make({ legacy }).removeItem(KEY);
    expect(legacy.m.has(KEY)).toBe(false);
  });

  it('degraded mode still moves the value out of localStorage (no plain copy kept)', async () => {
    const legacy = memoryLegacy({ [KEY]: SESSION });
    const s = make({ indexedDB: null, legacy });
    expect(await s.getItem(KEY)).toBe(SESSION);
    expect(legacy.m.has(KEY)).toBe(false);
    expect(await s.getItem(KEY)).toBe(SESSION);
  });

  it('a throwing legacy store is ignored', async () => {
    const legacy: LegacyStore = {
      getItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const s = make({ legacy });
    expect(await s.getItem(KEY)).toBeNull();
    await expect(s.setItem(KEY, 'v')).resolves.toBeUndefined();
    await expect(s.removeItem(KEY)).resolves.toBeUndefined();
  });
});
