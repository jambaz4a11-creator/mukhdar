// TanStack Query مع حفظ الكاش على AsyncStorage (فتح سريع، وعرض آخر بيانات بدون شبكة).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, type Query, QueryClient } from '@tanstack/react-query';

const DAY = 24 * 60 * 60 * 1000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // SPEC-customer §1: إعادة محاولة القراءة 3 مرات؛ الكتابة لا تُعاد تلقائياً
      queries: { retry: 3, staleTime: 5 * 60 * 1000, gcTime: DAY },
      mutations: { retry: false },
    },
  });
}

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'mukhdar.queryCache',
});

export const PERSIST_MAX_AGE = DAY;

/** عناوين الزبون (بيانات شخصية) لا تُحفظ على AsyncStorage؛ القوائم الهرمية والكتالوج تُحفظ. */
export function shouldPersistQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && query.queryKey[0] !== 'addresses';
}
