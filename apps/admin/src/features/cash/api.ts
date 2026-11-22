// تسليم الكاش (T41): قراءة وكتابة بجلسة الأدمن/الموظف عبر دوال T40 فقط (cash_outstanding، record_cash_handover،
// cash_handover_history، correct_cash_handover، report_cash، و R4: cash_fee_setting_impact)؛ لا قراءة مباشرة لجدول cash_handovers ولا مفتاح خادم.
// كل رقم من قاعدة البيانات؛ المتصفح يعرض فقط.
import type { MukhdarClient } from '@mukhdar/shared';
import { feePayload } from './feeSetting';
import { parseCashReport, type CashReport } from './report';

export const cashKeys = {
  all: ['cash'] as const,
  outstanding: ['cash', 'outstanding'] as const,
  orders: (driverId: string) => ['cash', 'orders', driverId] as const,
  history: (f: HistoryFilters) => ['cash', 'history', f.driverId, f.from, f.to] as const,
  report: (from: string, to: string) => ['cash', 'report', from, to] as const,
  feeSetting: ['cash', 'fee-setting'] as const,
  latest: (driverId: string) => ['cash', 'latest', driverId] as const,
};

/** أجرة التوصيل على الكاش اللي بيد السواق الآن (R4 M1، K20؛ أدمن فقط). */
export interface FeeImpact {
  driver_count: number;
  order_count: number;
  fees_iqd: number;
  includes_delivery_fee: boolean;
}

export interface OutstandingRow {
  driver_id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  outstanding_iqd: number;
  order_count: number;
  oldest_delivered_at: string | null;
  last_handover_at: string | null;
  last_received_iqd: number | null;
  last_difference_iqd: number | null;
  /** إعداد الأجرة الحالي (K19): يحدد نص "شامل/بدون أجرة التوصيل" */
  includes_delivery_fee: boolean;
}

export interface OutstandingOrderRow {
  order_id: string;
  order_number: number;
  delivered_at: string;
  amount_iqd: number;
  subsection: string | null;
  building: string | null;
}

export interface HandoverResult {
  handover_id: string;
  driver_id: string;
  order_count: number;
  expected_iqd: number;
  received_iqd: number;
  difference_iqd: number;
  recorded_at: string;
  replayed: boolean;
}

export interface HandoverRow {
  id: string;
  driver_id: string | null;
  driver_name: string | null;
  recorded_at: string;
  recorded_by_name: string | null;
  recorded_by_role: string | null;
  order_count: number;
  expected_iqd: number;
  received_iqd: number;
  difference_iqd: number;
  includes_delivery_fee: boolean;
  note: string | null;
  original_received_iqd: number | null;
  corrected_at: string | null;
  corrected_by_name: string | null;
}

export interface HistoryFilters {
  /** null = كل السواق */
  driverId: string | null;
  /** YYYY-MM-DD (بغداد) أو null */
  from: string | null;
  to: string | null;
}

export interface HistoryCursor {
  at: string;
  id: string;
}

export const HISTORY_PAGE = 50;

async function unwrap<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export async function fetchOutstanding(supabase: MukhdarClient): Promise<OutstandingRow[]> {
  return (await unwrap<OutstandingRow[] | null>(supabase.rpc('cash_outstanding'))) ?? [];
}

export async function fetchOutstandingOrders(
  supabase: MukhdarClient,
  driverId: string,
): Promise<OutstandingOrderRow[]> {
  return (
    (await unwrap<OutstandingOrderRow[] | null>(
      supabase.rpc('cash_outstanding_orders', { p_driver_id: driverId }),
    )) ?? []
  );
}

export function recordHandover(
  supabase: MukhdarClient,
  a: {
    driverId: string;
    expectedIqd: number;
    orderCount: number;
    receivedIqd: number;
    note: string | null;
    key: string;
  },
): Promise<HandoverResult> {
  return unwrap<HandoverResult>(
    supabase.rpc('record_cash_handover', {
      p_driver_id: a.driverId,
      p_expected_iqd: a.expectedIqd,
      p_order_count: a.orderCount,
      p_received_iqd: a.receivedIqd,
      p_note: a.note ?? '',
      p_idempotency_key: a.key,
    }),
  );
}

export async function fetchHistory(
  supabase: MukhdarClient,
  f: HistoryFilters,
  cursor: HistoryCursor | null,
): Promise<HandoverRow[]> {
  const rows = await unwrap<HandoverRow[] | null>(
    supabase.rpc('cash_handover_history', {
      p_limit: HISTORY_PAGE,
      ...(f.driverId ? { p_driver_id: f.driverId } : {}),
      ...(f.from ? { p_from: f.from } : {}),
      ...(f.to ? { p_to: f.to } : {}),
      ...(cursor ? { p_before_at: cursor.at, p_before_id: cursor.id } : {}),
    }),
  );
  return rows ?? [];
}

/** آخر تسليم مسجّل للسائق (R4 M2: بعد "انسجل قبل شوية" يُعرض مبلغه وملاحظته)؛ null إن لم يوجد. */
export async function fetchLatestHandover(
  supabase: MukhdarClient,
  driverId: string,
): Promise<HandoverRow | null> {
  const rows = await unwrap<HandoverRow[] | null>(
    supabase.rpc('cash_handover_history', { p_driver_id: driverId, p_limit: 1 }),
  );
  return rows?.[0] ?? null;
}

/** المؤشر التالي من آخر صف؛ undefined = لا صفحة أخرى (أقل من 50). */
export function nextCursor(rows: readonly HandoverRow[]): HistoryCursor | undefined {
  const last = rows[rows.length - 1];
  return rows.length >= HISTORY_PAGE && last ? { at: last.recorded_at, id: last.id } : undefined;
}

export function correctHandover(
  supabase: MukhdarClient,
  a: { id: string; receivedIqd: number; note: string; expectedReceived: number },
): Promise<unknown> {
  return unwrap(
    supabase.rpc('correct_cash_handover', {
      p_id: a.id,
      p_received_iqd: a.receivedIqd,
      p_note: a.note,
      // R4 L6: المبلغ الذي رآه الأدمن؛ تغيّر بعدها ← HANDOVER_CHANGED (لا كتابة فوق تصحيح أدمن آخر)
      p_expected_received: a.expectedReceived,
    }),
  );
}

export async function fetchCashReport(
  supabase: MukhdarClient,
  r: { from: string; to: string },
): Promise<CashReport> {
  const raw = await unwrap<unknown>(supabase.rpc('report_cash', { p_from: r.from, p_to: r.to }));
  return parseCashReport(raw);
}

/** إعداد الأجرة الحالي (K19): قيمة سياسة، يقرؤه الجميع كبقية app_settings. */
export async function fetchFeeSetting(supabase: MukhdarClient): Promise<boolean> {
  const row = await unwrap<{ cash_handover_includes_delivery_fee: boolean }>(
    supabase
      .from('app_settings')
      .select('cash_handover_includes_delivery_fee')
      .eq('id', 1)
      .single(),
  );
  return row.cash_handover_includes_delivery_fee;
}

/** قبل تغيير إعداد الأجرة (R4 M1): كم أجرة توصيل بيد السواق الآن تتأثر بالتغيير. */
export async function fetchFeeImpact(supabase: MukhdarClient): Promise<FeeImpact> {
  const rows = await unwrap<FeeImpact[] | null>(supabase.rpc('cash_fee_setting_impact'));
  return rows?.[0] ?? { driver_count: 0, order_count: 0, fees_iqd: 0, includes_delivery_fee: true };
}

/** التغيير عبر update_app_settings فقط (أدمن aal2، مُدقَّق)، بمفتاحه وحده. */
export function saveFeeSetting(
  supabase: MukhdarClient,
  includesDeliveryFee: boolean,
): Promise<unknown> {
  return unwrap(supabase.rpc('update_app_settings', { p: feePayload(includesDeliveryFee) }));
}
