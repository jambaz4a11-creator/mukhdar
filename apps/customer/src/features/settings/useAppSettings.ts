// app_settings (مقروءة للجميع بـ RLS): اختبار اتصال الرئيسية في T09، وشريط "المتجر مغلق" لاحقاً.
import { useQuery } from '@tanstack/react-query';
import type { MukhdarClient } from '@mukhdar/shared';
import { getSupabase } from '../../lib/supabase';

export interface AppSettings {
  store_open: boolean;
  closed_message: string | null;
  delivery_fee_iqd: number;
  min_order_iqd: number;
}

export const APP_SETTINGS_KEY = ['app_settings'] as const;

export async function fetchAppSettings(client: MukhdarClient): Promise<AppSettings> {
  const { data, error } = await client
    .from('app_settings')
    .select('store_open, closed_message, delivery_fee_iqd, min_order_iqd')
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

export function useAppSettings() {
  const client = getSupabase();
  return useQuery({
    queryKey: APP_SETTINGS_KEY,
    queryFn: () => fetchAppSettings(client as MukhdarClient),
    enabled: client !== null,
  });
}
