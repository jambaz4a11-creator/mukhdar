// الكاش منذ آخر تسليم (SPEC-cash §5، DRIVER-API "Cash handover"). المجاميع كلها من قاعدة البيانات (K10 و K11)؛ التطبيق
// يعرض فقط ولا يجمع ولا يحسب فرقاً. الطلبات بذمة السائق قراءة مباشرة بـ RLS الموجودة (عرض فقط).
import { parseBackendError, type MukhdarClient } from '@mukhdar/shared';
import type { AddressSnapshotView } from '../orders/types';

/** صفحة السجل (K11 يقبل 1..100). */
export const CASH_HISTORY_PAGE = 20;
/** حد قائمة الطلبات بذمته (SPEC-cash §5). */
export const IN_HAND_LIMIT = 200;

export interface CashSummary {
  outstanding_iqd: number;
  order_count: number;
  oldest_delivered_at: string | null;
  /** null = ما سلّم كاش بعد */
  last_handover_at: string | null;
  last_received_iqd: number | null;
  /** سالب = نقص، موجب = زيادة */
  last_difference_iqd: number | null;
  /** false = أجرة التوصيل تبقى عند السائق (الرقم = البضاعة فقط) */
  includes_delivery_fee: boolean;
}

export type CashSummaryResult =
  | { ok: true; summary: CashSummary }
  // code: NOT_ALLOWED (سائق عُطّل للتو) ← الشاشة تعيد فحص الحارس
  | { ok: false; message: string; code: string | null };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** driver_cash_summary(): صف واحد دائماً. bigint قد يصل نصاً فنحوّله. */
export async function fetchCashSummary(client: MukhdarClient): Promise<CashSummaryResult> {
  try {
    const { data, error } = await client.rpc('driver_cash_summary');
    if (error) {
      const e = parseBackendError(error);
      return { ok: false, message: e.message, code: e.code };
    }
    const row = (data as unknown as Record<string, unknown>[] | null)?.[0];
    if (!row) return { ok: false, message: parseBackendError(null).message, code: null };
    return {
      ok: true,
      summary: {
        outstanding_iqd: num(row.outstanding_iqd),
        order_count: num(row.order_count),
        oldest_delivered_at: strOrNull(row.oldest_delivered_at),
        last_handover_at: strOrNull(row.last_handover_at),
        last_received_iqd: numOrNull(row.last_received_iqd),
        last_difference_iqd: numOrNull(row.last_difference_iqd),
        includes_delivery_fee: row.includes_delivery_fee !== false,
      },
    };
  } catch (e) {
    const p = parseBackendError(e);
    return { ok: false, message: p.message, code: p.code };
  }
}

export interface CashHandover {
  id: string;
  recorded_at: string;
  order_count: number;
  expected_iqd: number;
  received_iqd: number;
  difference_iqd: number;
  includes_delivery_fee: boolean;
  note: string | null;
  /** الاسم الأول فقط (K11) */
  recorded_by_name: string | null;
  corrected_at: string | null;
}

export interface HistoryCursor {
  recorded_at: string;
  id: string;
}

export type CashHistoryResult =
  { ok: true; items: CashHandover[]; next: HistoryCursor | null } | { ok: false; message: string };

/** my_cash_handovers: الأحدث أولاً، keyset على (recorded_at, id). صفحة كاملة ← مؤشر للتالية، وإلا انتهت. */
export async function fetchCashHistory(
  client: MukhdarClient,
  cursor: HistoryCursor | null,
): Promise<CashHistoryResult> {
  const args = cursor
    ? { p_limit: CASH_HISTORY_PAGE, p_before_at: cursor.recorded_at, p_before_id: cursor.id }
    : { p_limit: CASH_HISTORY_PAGE };
  try {
    const { data, error } = await client.rpc('my_cash_handovers', args);
    if (error) return { ok: false, message: parseBackendError(error).message };
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const items: CashHandover[] = rows.map((r) => ({
      id: String(r.id),
      recorded_at: String(r.recorded_at),
      order_count: num(r.order_count),
      expected_iqd: num(r.expected_iqd),
      received_iqd: num(r.received_iqd),
      difference_iqd: num(r.difference_iqd),
      includes_delivery_fee: r.includes_delivery_fee !== false,
      note: strOrNull(r.note),
      recorded_by_name: strOrNull(r.recorded_by_name),
      corrected_at: strOrNull(r.corrected_at),
    }));
    const last = items[items.length - 1];
    const next =
      items.length >= CASH_HISTORY_PAGE && last
        ? { recorded_at: last.recorded_at, id: last.id }
        : null;
    return { ok: true, items, next };
  } catch (e) {
    return { ok: false, message: parseBackendError(e).message };
  }
}

export interface InHandOrder {
  id: string;
  order_number: number;
  total_iqd: number;
  delivered_at: string;
  address_snapshot: AddressSnapshotView | null;
}

export type InHandResult = { ok: true; orders: InHandOrder[] } | { ok: false; message: string };

/** الطلبات المسلّمة التي لم تُربط بتسليم بعد (عرض فقط؛ المجموع من fetchCashSummary). */
export async function fetchInHandOrders(
  client: MukhdarClient,
  userId: string,
): Promise<InHandResult> {
  try {
    const { data, error } = await client
      .from('orders')
      .select('id, order_number, total_iqd, delivered_at, address_snapshot')
      .eq('driver_id', userId)
      .eq('status', 'delivered')
      .is('cash_handover_id', null)
      .order('delivered_at', { ascending: false })
      .limit(IN_HAND_LIMIT);
    if (error) return { ok: false, message: parseBackendError(error).message };
    return { ok: true, orders: (data ?? []) as unknown as InHandOrder[] };
  } catch (e) {
    return { ok: false, message: parseBackendError(e).message };
  }
}

export type HandoverBadge = { kind: 'shortage' | 'overage'; amount: number };

/** شارة الفرق للعرض (القاعدة هي من حسبته: difference_iqd). مطابق أو غير معروف ← لا شارة. */
export function handoverBadge(difference: number | null): HandoverBadge | null {
  if (!difference) return null;
  return difference < 0
    ? { kind: 'shortage', amount: -difference }
    : { kind: 'overage', amount: difference };
}
