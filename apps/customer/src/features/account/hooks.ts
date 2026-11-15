// الاسم بحسابي (T15): profiles.full_name للمستخدم الحالي. لا يُحفظ على الجهاز.
import type { MukhdarClient } from '@mukhdar/shared';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '../../lib/supabase';
import { fetchFullName } from '../auth/api';
import { useAuth } from '../auth/store';
import { profileKeys } from './api';

export function useFullName() {
  const client = getSupabase();
  const userId = useAuth((s) => s.session?.user.id);
  return useQuery({
    queryKey: profileKeys.me(userId),
    queryFn: () => fetchFullName(client as MukhdarClient, userId as string),
    enabled: client !== null && !!userId,
  });
}
