// الرئيسية (T25): كل الأرقام من dashboard_today() (migration 20261127000001). المتصفح لا يجمع شيئاً.
// الموظف: حقول المال null من الدالة نفسها (SPEC-backend §12.3)، فلا شيء يُخفى هنا بل لا يصل أصلاً.
import type { MukhdarClient } from '@mukhdar/shared';
import { LIST_COLUMNS, ORDERS_PAGE_SIZE, ordersKeys, type OrderRow } from '@/features/orders/api';
import { baghdadDayRange } from '@/features/orders/filters';

/** تحت `orders` حتى يبطلها اشتراك Realtime القائم (PanelProviders) مع كل طلب جديد أو تغيّر حالة. */
export const dashboardKeys = {
  today: [...ordersKeys.all, 'dashboard', 'today'] as const,
  orders: (day: string) => [...ordersKeys.all, 'dashboard', 'orders', day] as const,
  storeOpen: ['dashboard', 'store-open'] as const,
};

/** المخزون خارج Realtime، والنافذة "حتى نفس الدقيقة" تتحرك: استطلاع كل دقيقة (كما بصفحة الإعدادات). */
export const DASHBOARD_POLL_MS = 60_000;

export interface OpenCounts {
  pending: number;
  preparing: number;
  ready: number;
  out_for_delivery: number;
}

export interface LowStockItem {
  product_id: string;
  name: string;
  unit: string;
  /** بوحدات البيع (أنصاف الكيلو)؛ العرض بالكيلو عبر formatAdminQuantity */
  qty: number;
  threshold: number;
}

export interface Dashboard {
  /** يوم بغداد "YYYY-MM-DD" */
  day: string;
  as_of: string;
  delivered_count: number;
  delivered_count_prev: number;
  cancelled_count: number;
  cancelled_count_prev: number;
  placed_count: number;
  placed_count_prev: number;
  open: OpenCounts;
  low_stock_count: number;
  low_stock_items: LowStockItem[];
  /** المال: null للموظف (من الدالة)، وللأدمن أرقام صحيحة بالدينار (avg وnet_prev قد تكون null بلا بيانات) */
  sales_iqd: number | null;
  sales_prev_iqd: number | null;
  avg_order_iqd: number | null;
  avg_order_prev_iqd: number | null;
  waste_cost_iqd: number | null;
  net_profit_iqd: number | null;
  net_profit_prev_iqd: number | null;
}

const COUNT_FIELDS = [
  'delivered_count',
  'delivered_count_prev',
  'cancelled_count',
  'cancelled_count_prev',
  'placed_count',
  'placed_count_prev',
  'low_stock_count',
] as const;

const MONEY_FIELDS = [
  'sales_iqd',
  'sales_prev_iqd',
  'avg_order_iqd',
  'avg_order_prev_iqd',
  'waste_cost_iqd',
  'net_profit_iqd',
  'net_profit_prev_iqd',
] as const;

const OPEN_FIELDS = ['pending', 'preparing', 'ready', 'out_for_delivery'] as const;

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** يتحقق من شكل dashboard_today(): الأعداد والمبالغ صحيحة (لا كسور)، والمال عدد أو null. وإلا خطأ واضح. */
export function parseDashboard(raw: unknown): Dashboard {
  if (!raw || typeof raw !== 'object') throw new Error('DASHBOARD_SHAPE');
  const r = raw as Record<string, unknown>;
  if (typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day))
    throw new Error('DASHBOARD_SHAPE: day');
  if (typeof r.as_of !== 'string' || Number.isNaN(Date.parse(r.as_of)))
    throw new Error('DASHBOARD_SHAPE: as_of');
  for (const k of COUNT_FIELDS) if (!isCount(r[k])) throw new Error(`DASHBOARD_SHAPE: ${k}`);
  for (const k of MONEY_FIELDS) {
    const v = r[k];
    if (v !== null && !Number.isSafeInteger(v)) throw new Error(`DASHBOARD_SHAPE: ${k}`);
  }
  const open = r.open as Record<string, unknown> | null;
  if (!open || typeof open !== 'object') throw new Error('DASHBOARD_SHAPE: open');
  for (const k of OPEN_FIELDS) if (!isCount(open[k])) throw new Error(`DASHBOARD_SHAPE: open.${k}`);
  if (!Array.isArray(r.low_stock_items)) throw new Error('DASHBOARD_SHAPE: low_stock_items');
  for (const it of r.low_stock_items as Record<string, unknown>[]) {
    if (
      typeof it?.product_id !== 'string' ||
      typeof it.name !== 'string' ||
      typeof it.unit !== 'string' ||
      !isCount(it.qty) ||
      !isCount(it.threshold)
    )
      throw new Error('DASHBOARD_SHAPE: low_stock_items[]');
  }
  return raw as Dashboard;
}

export async function fetchDashboard(client: MukhdarClient): Promise<Dashboard> {
  const { data, error } = await client.rpc('dashboard_today');
  if (error) throw error;
  return parseDashboard(data);
}

/** طلبات اليوم (بيوم بغداد من الدالة، أي حالة)، الأحدث أولاً، أول صفحة فقط؛ الباقي بصفحة الطلبات. */
export async function fetchTodayOrders(client: MukhdarClient, day: string): Promise<OrderRow[]> {
  const range = baghdadDayRange(day);
  const { data, error } = await client
    .from('orders')
    .select(LIST_COLUMNS)
    .gte('created_at', range.from)
    .lt('created_at', range.to)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(ORDERS_PAGE_SIZE);
  if (error) throw error;
  return (data ?? []) as unknown as OrderRow[];
}

/** حالة المحل (عامة للزبائن أصلاً، ليست مالاً). */
export async function fetchStoreOpen(client: MukhdarClient): Promise<boolean> {
  const { data, error } = await client
    .from('app_settings')
    .select('store_open')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data?.store_open ?? true;
}
