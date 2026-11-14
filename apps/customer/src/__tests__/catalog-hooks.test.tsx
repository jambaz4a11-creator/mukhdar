// hooks الكتالوج مع Supabase مزيف: الصفحة الثانية تُطلب بالمدى الصحيح (30..59)، الفلترة والترتيب، والبحث.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { escapeLike, PAGE_SIZE } from '../features/catalog/api';
import { useProductSearch, useProducts } from '../features/catalog/hooks';
import { type Call, createFakeSupabase, makeProduct, opArgs } from '../test-utils/fakeSupabase';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** 35 منتجاً: الصفحة الأولى 30 والثانية 5. */
const ALL = Array.from({ length: 35 }, (_, i) => makeProduct({ id: `p${i}`, sort_order: i }));
function resolveProducts(call: Call) {
  const [from, to] = (opArgs(call, 'range') ?? [0, 0]) as [number, number];
  return { data: ALL.slice(from, to + 1), error: null };
}

describe('useProducts (infinite, 30 per page)', () => {
  it('requests range 0..29, then 30..59 for the second page, ordered by sort_order, id', async () => {
    const fake = createFakeSupabase(resolveProducts);
    mockClient = fake.client;
    const { result } = await renderHook(() => useProducts(null), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fake.calls).toHaveLength(1);
    const first = fake.calls[0] as Call;
    expect(first.table).toBe('products');
    expect(opArgs(first, 'range')).toEqual([0, PAGE_SIZE - 1]);
    expect(first.ops.filter(([n]) => n === 'order').map(([, a]) => a[0])).toEqual([
      'sort_order',
      'id',
    ]);
    expect(first.ops).toContainEqual(['eq', ['is_active', true]]);
    // "الكل": بلا فلتر قسم
    expect(first.ops.some(([n, a]) => n === 'eq' && a[0] === 'category_id')).toBe(false);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(opArgs(fake.calls[1] as Call, 'range')).toEqual([30, 59]);
    expect(result.current.data?.pages.flat()).toHaveLength(35);
    // 5 < 30: لا صفحة ثالثة
    expect(result.current.hasNextPage).toBe(false);
  });

  it('filters by category', async () => {
    const fake = createFakeSupabase(() => ({ data: [], error: null }));
    mockClient = fake.client;
    const { result } = await renderHook(() => useProducts(7), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fake.calls[0]?.ops).toContainEqual(['eq', ['category_id', 7]]);
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe('useProductSearch', () => {
  it('searches active products by name with ilike, limit 30, escaping LIKE wildcards', async () => {
    const fake = createFakeSupabase(() => ({ data: [], error: null }));
    mockClient = fake.client;
    const { result } = await renderHook(() => useProductSearch('50%_off'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const call = fake.calls[0] as Call;
    expect(opArgs(call, 'ilike')).toEqual(['name', '%50\\%\\_off%']);
    expect(opArgs(call, 'limit')).toEqual([30]);
    expect(call.ops).toContainEqual(['eq', ['is_active', true]]);
  });

  it('does not query for an empty term', async () => {
    const fake = createFakeSupabase(() => ({ data: [], error: null }));
    mockClient = fake.client;
    await renderHook(() => useProductSearch(''), { wrapper });
    expect(fake.calls).toHaveLength(0);
  });

  it('escapeLike', () => {
    expect(escapeLike('طماطة')).toBe('طماطة');
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
  });
});
