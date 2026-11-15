// QueryClient للاختبارات (مراجعة T09-T15، S5). gcTime: Infinity يمنع مؤقتات جمع الكاش: الافتراضي 5 دقائق
// يبقي Node حياً بعد انتهاء الاختبارات (تشغيل ملف واحد كان ينتظر ~300 ثانية). كل client يُفرَّغ بعد كل
// اختبار من jest.setup.ts (clearTestQueryClients).
import { QueryClient } from '@tanstack/react-query';

const clients = new Set<QueryClient>();

export function createTestQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.add(client);
  return client;
}

export function clearTestQueryClients(): void {
  for (const client of clients) client.clear();
  clients.clear();
}
