// الويب (PWA السائق، يُربط فعلياً بتصدير الويب بـ T37/W4): جلسة Supabase مشفَّرة بـ IndexedDB ومفتاح WebCrypto
// غير قابل للتصدير (createWebSecureStorage من @mukhdar/shared، T34، SPEC-webpush §6). نفس واجهة secureStorage.ts.
// بلا ترحيل: السائق لم يكن له تخزين ويب قبل هذا. بلا IndexedDB: ذاكرة فقط وisSessionStorageDegraded() = true.
// لا تحمي من XSS على نفس الأصل؛ الـ CSP (T37) هو الدفاع الأول.
import { createWebSecureStorage } from '@mukhdar/shared';

/** مثيل واحد للجلسة وطلب التسجيل (secureStore.web.ts): قاعدة واحدة ومفتاح واحد للأصل. */
export const secureStorage = createWebSecureStorage();

/** true = ذاكرة فقط (الجلسة وسر الجهاز يضيعان بإغلاق التبويب). */
export const isSessionStorageDegraded = (): boolean => secureStorage.isDegraded();
