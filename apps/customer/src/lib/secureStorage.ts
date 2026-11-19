// تخزين جلسة Supabase بـ expo-secure-store (Keychain / Keystore) بدل AsyncStorage (T10).
// التقسيم لأجزاء ≤ 1800 حرف وتنظيف المفاتيح بـ createChunkedStorage من @mukhdar/shared (مشترك مع تطبيق السائق، T30).
import { createChunkedStorage } from '@mukhdar/shared';
import * as SecureStore from 'expo-secure-store';

export { CHUNK_SIZE } from '@mukhdar/shared';

export const secureStorage = createChunkedStorage(SecureStore);
