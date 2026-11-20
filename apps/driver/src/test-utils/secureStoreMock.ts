// expo-secure-store بالذاكرة للاختبارات، بنفس قيود المكتبة (مفاتيح [A-Za-z0-9._-]، قيمة ≤ 2048).
export const secureStoreMemory = new Map<string, string>();

export const secureStoreMock = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn((k: string) => Promise.resolve(secureStoreMemory.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(k)) return Promise.reject(new Error(`invalid key ${k}`));
    if (v.length > 2048) return Promise.reject(new Error('value too large'));
    secureStoreMemory.set(k, v);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    secureStoreMemory.delete(k);
    return Promise.resolve();
  }),
};
