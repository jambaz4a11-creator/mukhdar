// طلبات الزبون (T14، SPEC-customer §2.6-2.8): قراءة الطلب وبنوده وتقييمه، صفحات "طلباتي" بـ keyset، الإلغاء،
// التقييم، و"اطلب مرة أخرى". القراءة محمية بـ RLS (الزبون يرى طلباته فقط)، والتحويلات تُفرض داخل
// set_order_status / rate_order: الأزرار هنا للعرض فقط.
import type { AddressSnapshot, MukhdarClient, OrderStatus } from '@mukhdar/shared';
import { fetchProductsByIds, type Product } from '../catalog/api';
import { MAX_QTY } from '../cart/store';

export const ORDERS_PAGE_SIZE = 20;
export const RATING_COMMENT_MAX = 500;

export interface OrderItemView {
  product_id: string | null;
  name_snapshot: string;
  unit_snapshot: string;
  price_snapshot_iqd: number;
  qty: number;
  line_total_iqd: number;
}

export interface OrderDetail {
  id: string;
  order_number: number;
  status: OrderStatus;
  subtotal_iqd: number;
  delivery_fee_iqd: number;
  total_iqd: number;
  note: string | null;
  address_snapshot: AddressSnapshot;
  created_at: string;
  preparing_at: string | null;
  ready_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  items: OrderItemView[];
  /** null = لم يُقيَّم */
  rating: { stars: number } | null;
}

export interface OrderListItem {
  id: string;
  order_number: number;
  status: OrderStatus;
  total_iqd: number;
  created_at: string;
  items: Pick<OrderItemView, 'product_id' | 'name_snapshot' | 'qty'>[];
  rating: { stars: number } | null;
}

/** أعمدة الطلب التي تتغير مع الحالة (تُدمج من Realtime). */
export const ORDER_COLUMNS =
  'id, order_number, status, subtotal_iqd, delivery_fee_iqd, total_iqd, note, address_snapshot, ' +
  'created_at, preparing_at, ready_at, out_for_delivery_at, delivered_at, cancelled_at, cancel_reason';

const DETAIL_SELECT =
  `${ORDER_COLUMNS}, ` +
  'order_items(product_id, name_snapshot, unit_snapshot, price_snapshot_iqd, qty, line_total_iqd), ' +
  'ratings(stars)';

const LIST_SELECT =
  'id, order_number, status, total_iqd, created_at, ' +
  'order_items(product_id, name_snapshot, qty), ratings(stars)';

export const orderKeys = {
  /** كل قوائم الطلبات للمستخدم (لا تُحفظ على الجهاز: shouldPersistQuery). */
  list: (userId: string | undefined) => ['orders', userId ?? 'anon'] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
};

type RatingRel = { stars: number } | { stars: number }[] | null | undefined;

/** ratings علاقة واحد-لواحد: PostgREST يرجع كائناً أو null (ومصفوفة احتياطاً). */
function normalizeRating(r: RatingRel): { stars: number } | null {
  if (Array.isArray(r)) return r[0] ?? null;
  return r ?? null;
}

interface RawDetail extends Omit<OrderDetail, 'items' | 'rating'> {
  order_items: OrderItemView[] | null;
  ratings: RatingRel;
}

export async function fetchOrder(client: MukhdarClient, id: string): Promise<OrderDetail | null> {
  const { data, error } = await client
    .from('orders')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { order_items, ratings, ...order } = data as unknown as RawDetail;
  return { ...order, items: order_items ?? [], rating: normalizeRating(ratings) };
}

export interface OrdersCursor {
  created_at: string;
  id: string;
}

interface RawListItem extends Omit<OrderListItem, 'items' | 'rating'> {
  order_items: OrderListItem['items'] | null;
  ratings: RatingRel;
}

/**
 * صفحة من 20 طلب، الأحدث أولاً (created_at ثم id تنازلياً). keyset: الصفحة التالية تبدأ بعد آخر
 * (created_at, id) بالصفحة السابقة، فلا تتكرر الطلبات ولا تُفقد إن وصل طلب جديد أثناء التمرير.
 */
export async function fetchOrdersPage(
  client: MukhdarClient,
  userId: string,
  cursor: OrdersCursor | null,
): Promise<OrderListItem[]> {
  let q = client.from('orders').select(LIST_SELECT).eq('customer_id', userId);
  if (cursor) {
    // القيم بين علامتي تنصيص: الطابع الزمني فيه ":" و"+"
    q = q.or(
      `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(ORDERS_PAGE_SIZE);
  if (error) throw error;
  return (data as unknown as RawListItem[]).map(({ order_items, ratings, ...o }) => ({
    ...o,
    items: order_items ?? [],
    rating: normalizeRating(ratings),
  }));
}

/** صفحة كاملة = ربما توجد بعدها صفحة؛ أقل = النهاية. */
export function nextOrdersCursor(lastPage: OrderListItem[]): OrdersCursor | undefined {
  if (lastPage.length < ORDERS_PAGE_SIZE) return undefined;
  const last = lastPage[lastPage.length - 1];
  return last ? { created_at: last.created_at, id: last.id } : undefined;
}

/** الزبون يلغي طلبه وهو pending فقط (set_order_status يرفض غير ذلك بـ INVALID_TRANSITION). */
export async function cancelOrder(client: MukhdarClient, id: string): Promise<void> {
  const { error } = await client.rpc('set_order_status', {
    p_order_id: id,
    p_status: 'cancelled',
  });
  if (error) throw error;
}

export async function rateOrder(
  client: MukhdarClient,
  id: string,
  stars: number,
  comment: string,
): Promise<void> {
  const trimmed = comment.trim().slice(0, RATING_COMMENT_MAX);
  const { error } = await client.rpc('rate_order', {
    p_order_id: id,
    p_stars: stars,
    p_comment: trimmed === '' ? undefined : trimmed,
  });
  if (error) throw error;
}

/** زر التقييم: بعد التسليم فقط وإن لم يُقيَّم. */
export function canRate(order: { status: OrderStatus; rating: { stars: number } | null }): boolean {
  return order.status === 'delivered' && order.rating === null;
}

export interface ReorderPlan {
  add: { id: string; qty: number }[];
  /** أسماء البنود التي لم تُضف (موقوفة، غير متوفرة، أو حُذف المنتج) */
  skipped: string[];
}

/**
 * "اطلب مرة أخرى": المتوفر حالياً فقط (المنتج الموقوف لا يرجعه RLS، فيُعد غير متوفر). البند المكرر
 * بنفس المنتج يُجمع. السعر الحالي هو الذي يُطبَّق، لا سعر الطلب القديم.
 */
export function planReorder(
  items: OrderListItem['items'],
  current: Map<string, Product>,
): ReorderPlan {
  const qty = new Map<string, number>();
  const skipped: string[] = [];
  for (const item of items) {
    const product = item.product_id ? current.get(item.product_id) : undefined;
    if (!product || !product.in_stock) {
      if (!skipped.includes(item.name_snapshot)) skipped.push(item.name_snapshot);
      continue;
    }
    qty.set(product.id, Math.min(MAX_QTY, (qty.get(product.id) ?? 0) + item.qty));
  }
  return { add: [...qty].map(([id, q]) => ({ id, qty: q })), skipped };
}

export async function fetchReorderPlan(
  client: MukhdarClient,
  items: OrderListItem['items'],
): Promise<ReorderPlan> {
  const ids = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))];
  const products = ids.length > 0 ? await fetchProductsByIds(client, ids) : [];
  return planReorder(items, new Map(products.map((p) => [p.id, p])));
}
