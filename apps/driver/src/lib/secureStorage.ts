// جلسة Supabase بـ expo-secure-store (Keychain / Keystore)، مقسّمة لأجزاء بـ createChunkedStorage (@mukhdar/shared،
// نفس تخزين تطبيق الزبون).
import { createChunkedStorage } from '@mukhdar/shared';
import * as SecureStore from 'expo-secure-store';

export const secureStorage = createChunkedStorage(SecureStore);
