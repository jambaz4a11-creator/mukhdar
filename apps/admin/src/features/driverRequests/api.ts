// طلبات السواق (T29): قراءة وقرار بجلسة الأدمن عبر دالتي قاعدة البيانات (list_driver_requests،
// decide_driver_request؛ aal2 + مدقَّقتان بـ admin_audit). لا مفتاح خادم ولا Edge Function.
import type { MukhdarClient } from '@mukhdar/shared';

export const driverRequestsKeys = {
  all: ['driver-requests'] as const,
  list: (tab: DriverRequestTab) => ['driver-requests', 'list', tab] as const,
  pendingCount: ['driver-requests', 'pending-count'] as const,
};

export type DriverRequestTab = 'pending' | 'decided';

export interface DriverRequestRow {
  id: string;
  full_name: string;
  /** 9647XXXXXXXXX كما بقاعدة البيانات؛ للعرض displayPhone */
  phone: string;
  /** pending | approved | rejected | completed | expired (الأخيرة محسوبة) */
  status: string;
  created_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
}

const LIST_LIMIT = 200;

export async function fetchDriverRequests(
  supabase: MukhdarClient,
  tab: DriverRequestTab,
): Promise<DriverRequestRow[]> {
  const { data, error } = await supabase.rpc('list_driver_requests', {
    p_status: tab,
    p_limit: LIST_LIMIT,
  });
  if (error) throw error;
  return (data ?? []) as DriverRequestRow[];
}

/** عدد المعلّق لشارة القائمة (دالة العدّ، بلا جلب أسماء وأرقام: R1 L8). */
export async function fetchPendingDriverRequestCount(supabase: MukhdarClient): Promise<number> {
  const { data, error } = await supabase.rpc('pending_driver_requests_count');
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * approve=true ← موافقة (7 أيام)؛ false ← رفض (من pending) أو سحب موافقة (من approved، سارية أو منتهية؛ R1 M1)،
 * بملاحظة اختيارية. يرجع 'approved' | 'rejected'.
 */
export async function decideDriverRequest(
  supabase: MukhdarClient,
  id: string,
  approve: boolean,
  note?: string,
): Promise<string> {
  const args = { p_id: id, p_approve: approve, ...(note ? { p_note: note } : {}) };
  const { data, error } = await supabase.rpc('decide_driver_request', args);
  if (error) throw error;
  return data as string;
}
