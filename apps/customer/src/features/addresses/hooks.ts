// hooks العناوين. القوائم الهرمية تُخزَّن يوماً كاملاً (نادراً ما تتغير، SPEC-customer §2.5).
import type { MukhdarClient } from '@mukhdar/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/store';
import {
  addressKeys,
  fetchBlocks,
  fetchBuildings,
  fetchMyAddresses,
  fetchSectors,
  fetchSubsections,
  pickDeliveryAddress,
} from './api';
import { useSelectedAddress } from './selected';

export const HIERARCHY_STALE_MS = 24 * 60 * 60 * 1000;

export function useSectors() {
  const client = getSupabase();
  return useQuery({
    queryKey: addressKeys.sectors,
    queryFn: () => fetchSectors(client as MukhdarClient),
    enabled: client !== null,
    staleTime: HIERARCHY_STALE_MS,
  });
}

/** البلوكات (قطاع + وحدة) للقائمة المنسدلة بنموذج العنوان. */
export function useBlocks() {
  const client = getSupabase();
  return useQuery({
    queryKey: addressKeys.blocks,
    queryFn: () => fetchBlocks(client as MukhdarClient),
    enabled: client !== null,
    staleTime: HIERARCHY_STALE_MS,
  });
}

export function useSubsections(sectorId: number | null) {
  const client = getSupabase();
  return useQuery({
    queryKey: addressKeys.subsections(sectorId ?? 0),
    queryFn: () => fetchSubsections(client as MukhdarClient, sectorId as number),
    enabled: client !== null && sectorId !== null,
    staleTime: HIERARCHY_STALE_MS,
  });
}

export function useBuildings(subsectionId: number | null) {
  const client = getSupabase();
  return useQuery({
    queryKey: addressKeys.buildings(subsectionId ?? 0),
    queryFn: () => fetchBuildings(client as MukhdarClient, subsectionId as number),
    enabled: client !== null && subsectionId !== null,
    staleTime: HIERARCHY_STALE_MS,
  });
}

/** عناوين المستخدم المسجل. بلا جلسة: لا طلب. */
export function useMyAddresses() {
  const client = getSupabase();
  const userId = useAuth((s) => s.session?.user.id ?? null);
  return useQuery({
    queryKey: addressKeys.mine(userId ?? ''),
    queryFn: () => fetchMyAddresses(client as MukhdarClient),
    enabled: client !== null && userId !== null,
    staleTime: 0,
  });
}

/** عنوان التوصيل الحالي (المختار، أو الافتراضي). */
export function useDeliveryAddress() {
  const addresses = useMyAddresses();
  const selectedId = useSelectedAddress((s) => s.selectedId);
  return { ...addresses, address: pickDeliveryAddress(addresses.data, selectedId) };
}

/** يعيد قراءة عناوين المستخدم بعد أي تعديل. */
export function useInvalidateAddresses() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['addresses'] }),
    [queryClient],
  );
}
