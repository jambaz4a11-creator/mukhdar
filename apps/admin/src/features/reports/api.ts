// قراءة التقارير (أدمن). كل المجاميع من دوال قاعدة البيانات (report_*، migration 20261126000001)؛
// المتصفح يعرض فقط ولا يجمع. الموظف ترفضه قاعدة البيانات (NOT_ALLOWED) حتى لو فتح الصفحة.
import type { Database, MukhdarClient } from '@mukhdar/shared';
import type { DayRange } from './range';

type Fn = Database['public']['Functions'];
export type DailyRow = Fn['report_daily']['Returns'][number];
export type TopProductRow = Fn['report_top_products']['Returns'][number];
export type DriverRow = Fn['report_drivers']['Returns'][number];
export type WasteRow = Fn['report_waste']['Returns'][number];

export interface ReportSummary {
  from: string;
  to: string;
  placed_count: number;
  delivered_count: number;
  cancelled_count: number;
  sales_iqd: number;
  delivery_fees_iqd: number;
  cost_iqd: number;
  gross_profit_iqd: number;
  waste_cost_iqd: number;
  adjust_loss_iqd: number;
  net_profit_iqd: number;
  /** null بلا طلبات مسلّمة */
  avg_order_iqd: number | null;
  rating_count: number;
  /** رقم عشري واحد؛ null بلا تقييمات */
  rating_avg: number | null;
}

export interface RatingComment {
  order_id: string;
  order_number: number | null;
  stars: number;
  comment: string;
  created_at: string;
}

const INT_FIELDS = [
  'placed_count',
  'delivered_count',
  'cancelled_count',
  'sales_iqd',
  'delivery_fees_iqd',
  'cost_iqd',
  'gross_profit_iqd',
  'waste_cost_iqd',
  'adjust_loss_iqd',
  'net_profit_iqd',
  'rating_count',
] as const;

/** يتحقق من شكل report_summary: المبالغ والأعداد صحيحة (لا كسور)، وإلا خطأ. */
export function parseSummary(raw: unknown): ReportSummary {
  if (!raw || typeof raw !== 'object') throw new Error('REPORT_SHAPE');
  const r = raw as Record<string, unknown>;
  for (const k of INT_FIELDS) {
    if (!Number.isSafeInteger(r[k])) throw new Error(`REPORT_SHAPE: ${k}`);
  }
  const avg = r.avg_order_iqd;
  if (avg !== null && !Number.isSafeInteger(avg)) throw new Error('REPORT_SHAPE: avg_order_iqd');
  const rating = r.rating_avg;
  if (rating !== null && typeof rating !== 'number') throw new Error('REPORT_SHAPE: rating_avg');
  return r as unknown as ReportSummary;
}

export const reportKeys = {
  all: ['reports'] as const,
  range: (r: DayRange) => ['reports', r.from, r.to] as const,
};

async function unwrap<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

const args = (r: DayRange) => ({ p_from: r.from, p_to: r.to });

export interface ReportData {
  summary: ReportSummary;
  daily: DailyRow[];
  top: TopProductRow[];
  drivers: DriverRow[];
  waste: WasteRow[];
  comments: RatingComment[];
}

/** كل بيانات الصفحة لمدى واحد (طلبات متوازية). */
export async function fetchReport(supabase: MukhdarClient, r: DayRange): Promise<ReportData> {
  const [summary, daily, top, drivers, waste, comments] = await Promise.all([
    unwrap<unknown>(supabase.rpc('report_summary', args(r))).then(parseSummary),
    unwrap<DailyRow[]>(supabase.rpc('report_daily', args(r))),
    unwrap<TopProductRow[]>(supabase.rpc('report_top_products', { ...args(r), p_limit: 20 })),
    unwrap<DriverRow[]>(supabase.rpc('report_drivers', args(r))),
    unwrap<WasteRow[]>(supabase.rpc('report_waste', args(r))),
    fetchComments(supabase, r),
  ]);
  return { summary, daily, top, drivers, waste, comments };
}

/** آخر 20 تعليقاً بالمدى (RLS: الأدمن يقرأ التقييمات). حدود يوم بغداد (+03:00، بلا توقيت صيفي). */
export async function fetchComments(
  supabase: MukhdarClient,
  r: DayRange,
): Promise<RatingComment[]> {
  const rows = await unwrap<Record<string, unknown>[]>(
    supabase
      .from('ratings')
      .select('order_id, stars, comment, created_at, orders(order_number)')
      .not('comment', 'is', null)
      .gte('created_at', `${r.from}T00:00:00+03:00`)
      .lte('created_at', `${r.to}T23:59:59.999+03:00`)
      .order('created_at', { ascending: false })
      .limit(20),
  );
  return rows.map((x) => ({
    order_id: x.order_id as string,
    order_number: (x.orders as { order_number: number } | null)?.order_number ?? null,
    stars: x.stars as number,
    comment: x.comment as string,
    created_at: x.created_at as string,
  }));
}
