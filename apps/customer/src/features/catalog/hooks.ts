// hooks الكتالوج. الكاش يُحفظ على AsyncStorage (lib/query.ts)، فيُعرض آخر كتالوج حتى بدون شبكة.
import type { MukhdarClient } from '@mukhdar/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '../../lib/supabase';
import {
  catalogKeys,
  fetchCategories,
  fetchProduct,
  fetchProductsPage,
  nextPageParam,
  searchProducts,
} from './api';
import { findCachedProduct } from './cache';

export function useCategories() {
  const client = getSupabase();
  return useQuery({
    queryKey: catalogKeys.categories,
    queryFn: () => fetchCategories(client as MukhdarClient),
    enabled: client !== null,
  });
}

/** categoryId = null: كل المنتجات. صفحات 30 بتمرير لانهائي. */
export function useProducts(categoryId: number | null) {
  const client = getSupabase();
  return useInfiniteQuery({
    queryKey: catalogKeys.list(categoryId),
    queryFn: ({ pageParam }) => fetchProductsPage(client as MukhdarClient, categoryId, pageParam),
    initialPageParam: 0,
    getNextPageParam: nextPageParam,
    enabled: client !== null,
  });
}

/** term بعد debounce وtrim؛ فارغ = لا بحث. */
export function useProductSearch(term: string) {
  const client = getSupabase();
  return useQuery({
    queryKey: catalogKeys.search(term),
    queryFn: () => searchProducts(client as MukhdarClient, term),
    enabled: client !== null && term !== '',
  });
}

/** المنتج من الخلفية، ويُعرض فوراً من الكاش (القائمة أو البحث) إن وُجد. */
export function useProduct(id: string) {
  const client = getSupabase();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: catalogKeys.detail(id),
    queryFn: () => fetchProduct(client as MukhdarClient, id),
    placeholderData: () => findCachedProduct(queryClient, id),
    enabled: client !== null && id !== '',
  });
}
