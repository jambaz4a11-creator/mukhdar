// تخزين جلسة Supabase بمخزن مفتاح/قيمة آمن (expo-secure-store بالتطبيقين؛ نُقل من تطبيق الزبون بـ T30).
// SecureStore يحذّر من قيم أكبر من 2048 بايت، وجلسة Supabase (JWT + refresh + user) أكبر عادة،
// فالقيمة تُقسَّم: "<key>.n" = عدد الأجزاء، و"<key>.0".."<key>.n-1" = الأجزاء.
// المفاتيح تقبل [A-Za-z0-9._-] فقط، فيُستبدل أي حرف آخر. الحزمة لا تستورد expo: المخزن يُمرَّر.

export const CHUNK_SIZE = 1800;

/** نفس شكل expo-secure-store (getItemAsync/setItemAsync/deleteItemAsync). */
export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface ChunkedStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const safeStorageKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export function createChunkedStorage(store: KeyValueStore): ChunkedStorage {
  async function count(key: string): Promise<number> {
    const n = Number(await store.getItemAsync(`${key}.n`));
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  return {
    async getItem(rawKey) {
      const key = safeStorageKey(rawKey);
      const n = await count(key);
      if (n === 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await store.getItemAsync(`${key}.${i}`);
        if (part === null) return null; // كتابة ناقصة: كأن لا جلسة
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(rawKey, value) {
      const key = safeStorageKey(rawKey);
      const old = await count(key);
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE)
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      if (chunks.length === 0) chunks.push('');
      for (let i = 0; i < chunks.length; i++) {
        await store.setItemAsync(`${key}.${i}`, chunks[i] as string);
      }
      await store.setItemAsync(`${key}.n`, String(chunks.length));
      for (let i = chunks.length; i < old; i++) await store.deleteItemAsync(`${key}.${i}`);
    },

    async removeItem(rawKey) {
      const key = safeStorageKey(rawKey);
      const n = await count(key);
      await store.deleteItemAsync(`${key}.n`);
      for (let i = 0; i < n; i++) await store.deleteItemAsync(`${key}.${i}`);
    },
  };
}
