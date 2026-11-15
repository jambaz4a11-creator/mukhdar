'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchPendingCount, ordersKeys } from '@/features/orders/api';
import { usePanel } from './PanelProviders';

/** عدد الطلبات الجديدة لشارة القائمة: يبدأ بقيمة الخادم ويتحدث مع كل حدث Realtime. */
export function usePendingCount(initial: number): number {
  const { supabase } = usePanel();
  const { data } = useQuery({
    queryKey: ordersKeys.pendingCount,
    queryFn: () => fetchPendingCount(supabase),
    initialData: initial,
    initialDataUpdatedAt: 0,
  });
  return data;
}
