'use client';
import { useQuery } from '@tanstack/react-query';
import { driverRequestsKeys, fetchPendingDriverRequestCount } from '@/features/driverRequests/api';
import { usePanel } from './PanelProviders';

const POLL_MS = 60_000;

/**
 * عدد طلبات السواق المعلّقة لشارة القائمة (أدمن فقط؛ الدالة ترفض الموظف). يبدأ بقيمة الخادم ثم يتحدث عند
 * تركيز النافذة (افتراضي TanStack) وكل دقيقة، ويُبطَل بعد أي قرار.
 */
export function usePendingDriverRequests(initial: number, enabled: boolean): number {
  const { supabase } = usePanel();
  const { data } = useQuery({
    queryKey: driverRequestsKeys.pendingCount,
    queryFn: () => fetchPendingDriverRequestCount(supabase),
    initialData: initial,
    initialDataUpdatedAt: 0,
    enabled,
    refetchInterval: enabled ? POLL_MS : false,
  });
  return enabled ? data : 0;
}
