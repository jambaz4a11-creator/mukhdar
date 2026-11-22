/// <reference lib="dom" />
// التخزين المشفَّر للويب (T34، SPEC-webpush §6): بديل localStorage/SecureStore على المتصفح، لجلسة Supabase
// وسر جهاز السائق وبيانات التسجيل. متصفح فقط، بلا expo؛ لا شيء يُلمس عند الاستيراد (الأصلي يستورد الحزمة بأمان).
//
// - مفتاح AES-GCM 256 يُولَّد بـ extractable: false ويُحفظ ككائن CryptoKey بـ IndexedDB (لا بايتات خام أبداً).
// - كل كتابة: IV عشوائي 12 بايت، والقيمة المخزَّنة = {iv, ct}. اسم المدخل مربوط كـ AAD (نسخ سجل تحت اسم آخر لا يُفك).
// - فشل فك التشفير أو سجل تالف ← "لا قيمة" ويُمسح المدخل (لا استثناء ولا حلقة). مفتاح جديد ← تُمسح كل المدخلات القديمة.
// - لا IndexedDB أو WebCrypto (وضع خاص، سياق غير آمن، open معلّق) ← ذاكرة فقط، وisDegraded() = true لشريط تنبيه.
// - navigator.storage.persist() عند البدء (أفضل جهد).
// - legacy (localStorage القديم): ترحيل لمرة واحدة لكل مدخل (قراءة ← تشفير ← حذف)، وأي كتابة/حذف يمسح النسخة الصريحة.
// - R3 M3: اتصال IndexedDB أُغلق أو ضاع (onversionchange، حدث close، خلل WebKit "Connection to Indexed Database server
//   lost" بعد بقاء الـ PWA بالخلفية) ← يُفتح من جديد وتُعاد العملية مرة واحدة (نفس المفتاح المحفوظ، لا مسح).
//
// ما لا يحميه (SPEC-webpush §6.2): XSS على نفس الأصل يقدر يطلب decrypt بنفس المفتاح. الدفاع الأول هو CSP.

import type { ChunkedStorage } from './chunkedStorage';

export const WEB_SECURE_DB = 'mukhdar-secure';
export const WEB_SECURE_KEYS = 'keys';
export const WEB_SECURE_ITEMS = 'items';
const DB_VERSION = 1;
const KEY_ID = 'aes-gcm-v1';
const IV_BYTES = 12;

/** ما نحتاجه من localStorage للترحيل. */
export interface LegacyStore {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export interface WebSecureStorageOptions {
  /** الافتراضي globalThis.indexedDB؛ null = غير متاح. */
  indexedDB?: IDBFactory | null;
  /** الافتراضي globalThis.crypto؛ null = غير متاح. */
  crypto?: Crypto | null;
  dbName?: string;
  /** مصدر الترحيل لمرة واحدة (localStorage الزبون). */
  legacy?: LegacyStore | null;
  /** الافتراضي navigator.storage.persist. */
  persist?: (() => Promise<boolean> | undefined) | null;
  /** iOS قد يعلّق indexedDB.open: بعدها نعمل بالذاكرة. */
  openTimeoutMs?: number;
}

export interface WebSecureStorage extends ChunkedStorage {
  /** يفتح القاعدة ويجهّز المفتاح (يحدث تلقائياً بأول استعمال). */
  ready(): Promise<{ degraded: boolean }>;
  /** true = ذاكرة فقط (الجلسة تضيع بإغلاق التبويب). */
  isDegraded(): boolean;
}

interface Sealed {
  iv: Uint8Array;
  ct: ArrayBuffer;
}

type Backend =
  | { kind: 'idb'; db: IDBDatabase; key: CryptoKey; crypto: Crypto }
  | { kind: 'memory'; mem: Map<string, string> };

// تُنشأ عند الاستعمال فقط: الحزمة تُستورد أيضاً بالتطبيقات الأصلية (Hermes) حيث قد لا يوجد TextDecoder.
const utf8 = (s: string) => new TextEncoder().encode(s);

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** خطأ اتصال لا خطأ بيانات: يستحق إعادة الفتح. */
export function isIdbConnectionError(e: unknown): boolean {
  const err = e as { name?: unknown; message?: unknown } | null;
  const name = typeof err?.name === 'string' ? err.name : '';
  const message = typeof err?.message === 'string' ? err.message : '';
  return (
    name === 'InvalidStateError' ||
    name === 'UnknownError' ||
    /connection|closing|closed/i.test(message)
  );
}

function openDb(factory: IDBFactory, name: string, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, DB_VERSION); // قد يرمي (SecurityError) ← يرفض الوعد
    const timer = setTimeout(() => reject(new Error('indexedDB.open timeout')), timeoutMs);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(WEB_SECURE_KEYS)) db.createObjectStore(WEB_SECURE_KEYS);
      if (!db.objectStoreNames.contains(WEB_SECURE_ITEMS)) db.createObjectStore(WEB_SECURE_ITEMS);
    };
    r.onsuccess = () => {
      clearTimeout(timer);
      resolve(r.result);
    };
    r.onerror = () => {
      clearTimeout(timer);
      reject(r.error ?? new Error('indexedDB.open failed'));
    };
  });
}

function isAesKey(v: unknown): v is CryptoKey {
  const k = v as Partial<CryptoKey> | null;
  return (
    typeof k === 'object' && k !== null && k.type === 'secret' && k.algorithm?.name === 'AES-GCM'
  );
}

function isSealed(v: unknown): v is Sealed {
  const s = v as Partial<Sealed> | null;
  return (
    typeof s === 'object' &&
    s !== null &&
    ArrayBuffer.isView(s.iv) &&
    s.iv.byteLength === IV_BYTES &&
    Object.prototype.toString.call(s.ct) === '[object ArrayBuffer]' // لا instanceof: قد يأتي من realm آخر
  );
}

/**
 * المفتاح الموجود، أو مفتاح جديد يُحفظ ذرياً مع مسح المدخلات القديمة (لا تُفك بدونه أصلاً).
 * تبويبان يبدآن معاً: المعاملة الثانية تجد مفتاح الأولى وتستعمله.
 */
async function loadKey(db: IDBDatabase, crypto: Crypto): Promise<CryptoKey> {
  const existing = await request(
    db.transaction(WEB_SECURE_KEYS, 'readonly').objectStore(WEB_SECURE_KEYS).get(KEY_ID),
  );
  if (isAesKey(existing)) return existing;
  const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([WEB_SECURE_KEYS, WEB_SECURE_ITEMS], 'readwrite');
    let chosen = fresh;
    const keys = tx.objectStore(WEB_SECURE_KEYS);
    const g = keys.get(KEY_ID);
    g.onsuccess = () => {
      if (isAesKey(g.result)) {
        chosen = g.result;
      } else {
        keys.put(fresh, KEY_ID);
        tx.objectStore(WEB_SECURE_ITEMS).clear();
      }
    };
    tx.oncomplete = () => resolve(chosen);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('key transaction aborted'));
  });
}

export function createWebSecureStorage(opts: WebSecureStorageOptions = {}): WebSecureStorage {
  const g = globalThis as {
    indexedDB?: IDBFactory;
    crypto?: Crypto;
    navigator?: { storage?: { persist?: () => Promise<boolean> } };
  };
  const dbName = opts.dbName ?? WEB_SECURE_DB;
  const legacy = opts.legacy ?? null;
  let backend: Promise<Backend> | null = null;
  let degraded = false;

  async function init(): Promise<Backend> {
    const factory = opts.indexedDB === undefined ? g.indexedDB : opts.indexedDB;
    const crypto = opts.crypto === undefined ? g.crypto : opts.crypto;
    try {
      if (!factory || !crypto?.subtle) throw new Error('unavailable');
      const db = await openDb(factory, dbName, opts.openTimeoutMs ?? 5000);
      const self = backend;
      const forget = () => {
        if (backend === self) backend = null; // الاستعمال التالي يفتح اتصالاً جديداً
      };
      db.onversionchange = () => {
        db.close(); // لا نعرقل ترقية من تبويب أحدث
        forget();
      };
      db.onclose = forget; // أغلقه المتصفح (مسح بيانات الموقع، خلل الخادم)
      const key = await loadKey(db, crypto);
      try {
        const persist =
          opts.persist === undefined ? () => g.navigator?.storage?.persist?.() : opts.persist;
        void Promise.resolve(persist?.()).catch(() => undefined);
      } catch {
        /* أفضل جهد */
      }
      return { kind: 'idb', db, key, crypto };
    } catch {
      degraded = true;
      return { kind: 'memory', mem: new Map() };
    }
  }

  const ready = () => (backend ??= init());

  /** العملية على الاتصال الحالي؛ خطأ اتصال ← اتصال جديد ومحاولة ثانية واحدة. */
  async function run<T>(op: (b: Backend) => Promise<T>): Promise<T> {
    const current = ready();
    const b = await current;
    try {
      return await op(b);
    } catch (e) {
      if (b.kind !== 'idb' || !isIdbConnectionError(e)) throw e;
      if (backend === current) backend = null;
      try {
        b.db.close();
      } catch {
        /* مغلق أصلاً */
      }
      return op(await ready());
    }
  }

  function dropLegacy(key: string) {
    try {
      legacy?.removeItem(key);
    } catch {
      /* localStorage غير متاح */
    }
  }

  async function del(b: Backend, key: string) {
    if (b.kind === 'memory') b.mem.delete(key);
    else
      await request(
        b.db.transaction(WEB_SECURE_ITEMS, 'readwrite').objectStore(WEB_SECURE_ITEMS).delete(key),
      );
  }

  async function read(b: Backend, key: string): Promise<string | null> {
    if (b.kind === 'memory') return b.mem.get(key) ?? null;
    const rec: unknown = await request(
      b.db.transaction(WEB_SECURE_ITEMS, 'readonly').objectStore(WEB_SECURE_ITEMS).get(key),
    );
    if (rec === undefined) return null;
    try {
      if (!isSealed(rec)) throw new Error('malformed');
      const plain = await b.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(rec.iv), additionalData: utf8(key) },
        b.key,
        rec.ct,
      );
      return new TextDecoder().decode(plain);
    } catch {
      await del(b, key).catch(() => undefined); // تالف أو بمفتاح آخر: "لا قيمة"، ويُمسح حتى لا يتكرر
      return null;
    }
  }

  async function write(b: Backend, key: string, value: string) {
    if (b.kind === 'memory') {
      b.mem.set(key, value);
      return;
    }
    const iv = b.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = await b.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: utf8(key) },
      b.key,
      utf8(value),
    );
    const sealed: Sealed = { iv, ct };
    await request(
      b.db
        .transaction(WEB_SECURE_ITEMS, 'readwrite')
        .objectStore(WEB_SECURE_ITEMS)
        .put(sealed, key),
    );
  }

  const storage: WebSecureStorage = {
    async ready() {
      await ready();
      return { degraded };
    },

    isDegraded: () => degraded,

    async getItem(key) {
      try {
        const value = await run((b) => read(b, key));
        if (value !== null || !legacy) return value;
        let old: string | null = null;
        try {
          old = legacy.getItem(key);
        } catch {
          return null;
        }
        if (old === null) return null;
        await storage.setItem(key, old); // يشفّر ثم يحذف النسخة الصريحة
        return old;
      } catch {
        return null;
      }
    },

    async setItem(key, value) {
      try {
        await run((b) => write(b, key, value));
      } catch {
        // الكتابة فشلت (امتلاء…): لا نترك قيمة أقدم قد تكون رمزاً مُدوَّراً
        await run((b) => del(b, key)).catch(() => undefined);
      }
      dropLegacy(key);
    },

    async removeItem(key) {
      try {
        await run((b) => del(b, key));
      } catch {
        /* لا شيء نفعله */
      }
      dropLegacy(key);
    },
  };
  return storage;
}
