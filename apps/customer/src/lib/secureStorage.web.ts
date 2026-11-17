// الويب: لا Keychain/Keystore ولا expo-secure-store. الجلسة بـ localStorage (نفس واجهة secureStorage الأصلي).
// أقل حماية من الأصلي (أي سكربت بنفس الأصل يقرأها)؛ مقبول للنسخة التجريبية، والـ CSP بـ public/_headers يقلّل الخطر.
// localStorage قد يرمي (وضع خاص قديم، تخزين ممتلئ): نبتلع الخطأ فيعمل التطبيق بدون حفظ الجلسة بدل الانهيار.
const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const CHUNK_SIZE = 1800;

export const secureStorage = {
  getItem(key: string): Promise<string | null> {
    try {
      return Promise.resolve(store()?.getItem(key) ?? null);
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem(key: string, value: string): Promise<void> {
    try {
      store()?.setItem(key, value);
    } catch {
      /* تخزين غير متاح */
    }
    return Promise.resolve();
  },
  removeItem(key: string): Promise<void> {
    try {
      store()?.removeItem(key);
    } catch {
      /* تخزين غير متاح */
    }
    return Promise.resolve();
  },
};
