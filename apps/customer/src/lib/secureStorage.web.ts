// الويب: لا Keychain/Keystore. جلسة Supabase مشفَّرة بـ IndexedDB ومفتاح WebCrypto غير قابل للتصدير
// (createWebSecureStorage من @mukhdar/shared، T34، SPEC-webpush §6). لا تحمي من XSS على نفس الأصل
// (يقدر يطلب فك التشفير)، فالـ CSP بـ public/_headers يبقى الدفاع الأول.
// ترحيل لمرة واحدة: جلسة قديمة بـ localStorage الصريح تُقرأ ← تُشفَّر ← تُحذف من localStorage.
// بلا IndexedDB (وضع خاص) أو WebCrypto: ذاكرة فقط، وisSessionStorageDegraded() = true.
import { createWebSecureStorage, type LegacyStore } from '@mukhdar/shared';

/** localStorage يُقرأ عند الحاجة (قد يغيب أو يرمي بوضع خاص قديم). */
const legacyLocalStorage: LegacyStore = {
  getItem: (key) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
  removeItem: (key) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};

export const CHUNK_SIZE = 1800; // نفس تصدير secureStorage.ts (غير مستعمل على الويب)

export const secureStorage = createWebSecureStorage({ legacy: legacyLocalStorage });

/** true = الجلسة بالذاكرة فقط (تضيع بإغلاق التبويب). */
export const isSessionStorageDegraded = (): boolean => secureStorage.isDegraded();
