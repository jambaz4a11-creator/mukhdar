// قراءة وكتابة الطلبات باللوحة بجلسة المستخدم (RLS). لا أعمدة كلفة للموظف: order_item_costs تُجلب
// للأدمن فقط (fetchOrderCosts)، ولا تُطلب أصلاً لغيره.
import type { MukhdarClient, OrderStatus } from '@mukhdar/shared';
import type { PanelRole } from '@/lib/access';
import {
  TABS,
  baghdadDayRange,
  conditionsFor,
  keysetFilter,
  type Cursor,
  type OrdersFilters,
  type OrdersTab,
  type QueryConditions,
} from './filters';
import { assertPanelSessionAlive } from '@/lib/panelSession';

export const ORDERS_PAGE_SIZE = 50;

/** أعمدة الجدول (لا كلفة). */
export const LIST_COLUMNS =
  'id, order_number, status, created_at, customer_name, customer_phone, address_snapshot, total_iqd, driver_id';

const DETAIL_COLUMNS =
  `${LIST_COLUMNS}, customer_id, subtotal_iqd, delivery_fee_iqd, note, cancel_reason, preparing_at, ready_at, ` +
  'out_for_delivery_at, delivered_at, cancelled_at, ' +
  'order_items(id, name_snapshot, unit_snapshot, price_snapshot_iqd, qty, line_total_iqd), ' +
  'order_status_history(id, from_status, to_status, note, created_at), ' +
  'ratings(stars, comment, created_at)';

export interface OrderRow {
  id: string;
  order_number: number;
  status: OrderStatus;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  address_snapshot: unknown;
  total_iqd: number;
  driver_id: string | null;
}

export interface OrderItem {
  id: number;
  name_snapshot: string;
  unit_snapshot: string;
  price_snapshot_iqd: number;
  qty: number;
  line_total_iqd: number;
}

export interface OrderDetail extends OrderRow {
  /** null = حساب محذوف (T23 M5) */
  customer_id: string | null;
  subtotal_iqd: number;
  delivery_fee_iqd: number;
  note: string | null;
  cancel_reason: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  order_items: OrderItem[];
  order_status_history: {
    id: number;
    from_status: OrderStatus | null;
    to_status: OrderStatus;
    note: string | null;
    created_at: string;
  }[];
  /** علاقة واحد لواحد (PostgREST يرجعها كائناً أو null). */
  ratings: { stars: number; comment: string | null; created_at: string } | null;
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  /** رمز مؤقت لم يُغيَّر: لا يُسند له طلب (DRIVER_PIN_PENDING) */
  must_change_pin: boolean;
}

export const ordersKeys = {
  all: ['orders'] as const,
  counts: (day: string) => ['orders', 'counts', day] as const,
  pendingCount: ['orders', 'counts', 'pending'] as const,
  list: (filters: OrdersFilters, today: string) => ['orders', 'list', filters, today] as const,
  detail: (id: string, role: PanelRole) => ['orders', 'detail', id, role] as const,
  drivers: ['drivers'] as const,
};

// أنواع PostgREST العامة تكفي هنا؛ الواجهة المحددة تقلل الربط بأنواع supabase-js الداخلية.
interface Filterable<T> {
  eq(column: string, value: unknown): T;
  gte(column: string, value: string): T;
  lt(column: string, value: string): T;
}

export function applyConditions<T extends Filterable<T>>(q: T, c: QueryConditions): T {
  let r = q;
  if (c.status) r = r.eq('status', c.status);
  if (c.range) r = r.gte(c.range.column, c.range.from).lt(c.range.column, c.range.to);
  if (c.driverId) r = r.eq('driver_id', c.driverId);
  if (c.orderNumber !== null) r = r.eq('order_number', c.orderNumber);
  if (c.phone !== null) r = r.eq('customer_phone', c.phone);
  return r;
}

export interface OrdersPage {
  rows: OrderRow[];
  next: Cursor | null;
}

export async function fetchOrdersPage(
  client: MukhdarClient,
  filters: OrdersFilters,
  today: string,
  cursor: Cursor | null,
): Promise<OrdersPage | 'invalid'> {
  const cond = conditionsFor(filters, today);
  if (cond === 'invalid') return 'invalid';
  let q = applyConditions(client.from('orders').select(LIST_COLUMNS), cond);
  if (cursor) q = q.or(keysetFilter(cursor));
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(ORDERS_PAGE_SIZE);
  if (error) throw error;
  const rows = (data ?? []) as unknown as OrderRow[];
  // T23 F M4: جلسة خاملة تُرجع قائمة فارغة (RLS لا يرمي): لا نعرضها قبل التأكد أن الجلسة حيّة
  if (rows.length === 0 && !cursor) await assertPanelSessionAlive(client);
  const last = rows.at(-1);
  return {
    rows,
    next:
      rows.length === ORDERS_PAGE_SIZE && last
        ? { created_at: last.created_at, id: last.id }
        : null,
  };
}

/** عدادات التبويبات (head: true، بلا صفوف). المفتوحة: كل المفتوح؛ المسلّم والملغي: يوم `day`. */
export async function fetchTabCounts(
  client: MukhdarClient,
  day: string,
  driverId: string | null = null,
): Promise<Record<OrdersTab, number>> {
  const range = baghdadDayRange(day);
  const results = await Promise.all(
    TABS.map(async (tab) => {
      let q = client.from('orders').select('id', { count: 'exact', head: true }).eq('status', tab);
      if (tab === 'delivered') q = q.gte('delivered_at', range.from).lt('delivered_at', range.to);
      if (tab === 'cancelled') q = q.gte('cancelled_at', range.from).lt('cancelled_at', range.to);
      if (driverId) q = q.eq('driver_id', driverId);
      const { count, error } = await q;
      if (error) throw error;
      return [tab, count ?? 0] as const;
    }),
  );
  if (results.every(([, n]) => n === 0)) await assertPanelSessionAlive(client); // T23 F M4
  return Object.fromEntries(results) as Record<OrdersTab, number>;
}

export async function fetchPendingCount(client: MukhdarClient): Promise<number> {
  const { count, error } = await client
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}

export async function fetchOrderDetail(
  client: MukhdarClient,
  id: string,
): Promise<OrderDetail | null> {
  const { data, error } = await client
    .from('orders')
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .order('created_at', { referencedTable: 'order_status_history', ascending: true })
    .order('id', { referencedTable: 'order_items', ascending: true })
    .maybeSingle();
  if (error) throw error;
  return data as unknown as OrderDetail | null;
}

/** للأدمن فقط: كلفة البنود. الموظف لا يستدعيها (ولو استدعاها لرجعت فارغة بـ RLS). */
export async function fetchOrderCosts(
  client: MukhdarClient,
  role: PanelRole,
  itemIds: number[],
): Promise<{ order_item_id: number; cost_snapshot_iqd: number }[] | null> {
  if (role !== 'admin') return null;
  if (itemIds.length === 0) return [];
  const { data, error } = await client
    .from('order_item_costs')
    .select('order_item_id, cost_snapshot_iqd')
    .in('order_item_id', itemIds);
  if (error) throw error;
  return data ?? [];
}

export async function fetchDrivers(client: MukhdarClient): Promise<Driver[]> {
  const { data, error } = await client.rpc('list_drivers');
  if (error) throw error;
  return (data ?? []) as Driver[];
}

export async function setOrderStatus(
  client: MukhdarClient,
  orderId: string,
  status: OrderStatus,
  reason?: string,
  returnStock = true,
): Promise<void> {
  const { error } = await client.rpc('set_order_status', {
    p_order_id: orderId,
    p_status: status,
    ...(reason ? { p_reason: reason } : {}),
    ...(returnStock ? {} : { p_return_stock: false }),
  });
  if (error) throw error;
}

export async function assignDriver(
  client: MukhdarClient,
  orderId: string,
  driverId: string,
): Promise<void> {
  const { error } = await client.rpc('assign_driver', {
    p_order_id: orderId,
    p_driver_id: driverId,
  });
  if (error) throw error;
}
