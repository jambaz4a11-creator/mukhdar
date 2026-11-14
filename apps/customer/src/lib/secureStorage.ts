// تخزين جلسة Supabase بـ expo-secure-store (Keychain / Keystore) بدل AsyncStorage (T10).
// SecureStore يحذّر من قيم أكبر من 2048 بايت، وجلسة Supabase (JWT + refresh + user) أكبر عادة،
// فالقيمة تُقسَّم: "<key>.n" = عدد الأجزاء، و"<key>.0".."<key>.n-1" = الأجزاء.
// المفاتيح تقبل [A-Za-z0-9._-] فقط، فيُستبدل أي حرف آخر.
import * as SecureStore from 'expo-secure-store';

export const CHUNK_SIZE = 1800;

const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

async function count(key: string): Promise<number> {
  const n = Number(await SecureStore.getItemAsync(`${key}.n`));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export const secureStorage = {
  async getItem(rawKey: string): Promise<string | null> {
    const key = safeKey(rawKey);
    const n = await count(key);
    if (n === 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part === null) return null; // كتابة ناقصة: كأن لا جلسة
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(rawKey: string, value: string): Promise<void> {
    const key = safeKey(rawKey);
    const old = await count(key);
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
    if (chunks.length === 0) chunks.push('');
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, chunks[i] as string);
    }
    await SecureStore.setItemAsync(`${key}.n`, String(chunks.length));
    for (let i = chunks.length; i < old; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
  },

  async removeItem(rawKey: string): Promise<void> {
    const key = safeKey(rawKey);
    const n = await count(key);
    await SecureStore.deleteItemAsync(`${key}.n`);
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
  },
};
