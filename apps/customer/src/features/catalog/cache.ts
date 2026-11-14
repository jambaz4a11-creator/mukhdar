// البحث عن منتج بكاش TanStack Query (القوائم، البحث، التفاصيل) بدون طلب شبكة.
// السلة تخزن product_id والكمية فقط (SPEC-customer §2.3)، فالسعر يُقرأ من هنا.
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { catalogKeys, type Product } from './api';

function isProduct(v: unknown): v is Product {
  return typeof v === 'object' && v !== null && 'id' in v && 'price_iqd' in v;
}

/** يجمع المنتجات من أي شكل بيانات: صفحات (infinite)، قائمة، أو منتج واحد. */
function collect(data: unknown, out: Map<string, Product>): void {
  if (Array.isArray(data)) {
    for (const item of data) collect(item, out);
  } else if (isProduct(data)) {
    out.set(data.id, data);
  } else if (typeof data === 'object' && data !== null && 'pages' in data) {
    collect((data as InfiniteData<unknown>).pages, out);
  }
}

export function cachedProductMap(queryClient: QueryClient): Map<string, Product> {
  const out = new Map<string, Product>();
  // الأقدم أولاً حتى تغلب البيانات الأحدث
  const entries = queryClient
    .getQueryCache()
    .findAll({ queryKey: catalogKeys.products })
    .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
  for (const q of entries) collect(q.state.data, out);
  return out;
}

export function findCachedProduct(queryClient: QueryClient, id: string): Product | undefined {
  return cachedProductMap(queryClient).get(id);
}
