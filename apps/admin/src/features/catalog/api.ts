// قراءة وكتابة الكتالوج والمخزون بجلسة المستخدم (RLS). المنتجات وأسعار الشراء والحركات عبر دوال
// قاعدة البيانات فقط (T18)؛ الأقسام كتابة مباشرة للأدمن. الموظف لا يطلب أي مبلغ (لا product_costs).
import type { MukhdarClient, Database } from '@mukhdar/shared';
import type { PanelRole } from '@/lib/access';
import type { ProductPayload } from './forms';

export type MovementType = Database['public']['Enums']['movement_type'];

export const catalogKeys = {
  all: ['catalog'] as const,
  categories: ['catalog', 'categories'] as const,
  products: (role: PanelRole) => ['catalog', 'products', role] as const,
  movements: (productId: string, filters: MovementFilters) =>
    ['catalog', 'movements', productId, filters] as const,
  wasteHistory: ['catalog', 'waste-history'] as const,
};

export interface Category {
  id: number;
  name: string;
  image_path: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Product {
  id: string;
  category_id: number;
  name: string;
  description: string | null;
  unit: string;
  price_iqd: number;
  image_path: string | null;
  is_active: boolean;
  in_stock: boolean;
  sort_order: number;
  qty: number;
  low_stock_threshold: number;
  stock_updated_at: string | null;
  /** للأدمن فقط؛ null للموظف (لا يُطلب) أو منتج بلا سعر شراء. */
  cost_iqd: number | null;
}

async function unwrap<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export async function fetchCategories(supabase: MukhdarClient): Promise<Category[]> {
  return unwrap<Category[]>(
    supabase
      .from('categories')
      .select('id, name, image_path, sort_order, is_active')
      .order('sort_order')
      .order('id'),
  );
}

type StockEmbed = { qty: number; low_stock_threshold: number; updated_at: string } | null;
type CostEmbed = { cost_iqd: number } | null;

const PRODUCT_COLUMNS =
  'id, category_id, name, description, unit, price_iqd, image_path, is_active, in_stock, sort_order, ' +
  'stock(qty, low_stock_threshold, updated_at)';

/** المنتجات مع الرصيد (أدمن وموظف)، وسعر الشراء للأدمن فقط (لا يُطلب للموظف). */
export async function fetchProducts(supabase: MukhdarClient, role: PanelRole): Promise<Product[]> {
  const columns =
    role === 'admin' ? `${PRODUCT_COLUMNS}, product_costs(cost_iqd)` : PRODUCT_COLUMNS;
  const rows = await unwrap<Record<string, unknown>[]>(
    supabase.from('products').select(columns).order('sort_order').order('name'),
  );
  return rows.map((r) => {
    const stock = r.stock as StockEmbed;
    const cost = (r.product_costs ?? null) as CostEmbed;
    return {
      id: r.id as string,
      category_id: r.category_id as number,
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      unit: r.unit as string,
      price_iqd: r.price_iqd as number,
      image_path: (r.image_path as string | null) ?? null,
      is_active: r.is_active as boolean,
      in_stock: r.in_stock as boolean,
      sort_order: r.sort_order as number,
      qty: stock?.qty ?? 0,
      low_stock_threshold: stock?.low_stock_threshold ?? 5,
      stock_updated_at: stock?.updated_at ?? null,
      cost_iqd: role === 'admin' ? (cost?.cost_iqd ?? null) : null,
    };
  });
}

export function isLow(p: Pick<Product, 'qty' | 'low_stock_threshold'>): boolean {
  return p.qty < p.low_stock_threshold;
}

// ---------------------------------------------------------------- المنتجات (دوال)
export async function saveProduct(
  supabase: MukhdarClient,
  payload: Partial<ProductPayload> & { id?: string; image_path?: string | null },
): Promise<string> {
  return unwrap<string>(supabase.rpc('admin_save_product', { p: payload }));
}

export async function setProductPrice(supabase: MukhdarClient, id: string, price: number) {
  await unwrap(supabase.rpc('set_product_price', { p_product_id: id, p_price_iqd: price }));
}

export async function reorderProducts(supabase: MukhdarClient, ids: string[]) {
  await unwrap(supabase.rpc('reorder_products', { p_ids: ids }));
}

// ---------------------------------------------------------------- الأقسام (RLS: أدمن)
export async function createCategory(supabase: MukhdarClient, name: string, sortOrder: number) {
  return unwrap<{ id: number }>(
    supabase.from('categories').insert({ name, sort_order: sortOrder }).select('id').single(),
  );
}

export async function updateCategory(
  supabase: MukhdarClient,
  id: number,
  patch: Partial<Pick<Category, 'name' | 'image_path' | 'is_active' | 'sort_order'>>,
) {
  await unwrap(supabase.from('categories').update(patch).eq('id', id).select('id'));
}

/** الترتيب بالسحب: sort_order = الموضع (الأقسام قليلة، تحديث لكل قسم تغيّر موضعه). */
export async function reorderCategories(supabase: MukhdarClient, ordered: Category[]) {
  await Promise.all(
    ordered
      .map((c, i) => ({ c, pos: i + 1 }))
      .filter(({ c, pos }) => c.sort_order !== pos)
      .map(({ c, pos }) => updateCategory(supabase, c.id, { sort_order: pos })),
  );
}

// ---------------------------------------------------------------- المخزون (دوال، أدمن)
export async function adjustStock(
  supabase: MukhdarClient,
  args: { productId: string; qty: number; type: MovementType; note?: string; unitCost?: number },
): Promise<number> {
  return unwrap<number>(
    supabase.rpc('adjust_stock', {
      p_product_id: args.productId,
      p_qty: args.qty,
      p_type: args.type,
      p_note: args.note,
      p_unit_cost_iqd: args.unitCost,
    }),
  );
}

export async function adjustStockBulk(
  supabase: MukhdarClient,
  items: { product_id: string; qty: number; unit_cost_iqd?: number }[],
  type: MovementType,
  note?: string,
): Promise<number> {
  return unwrap<number>(
    supabase.rpc('adjust_stock_bulk', { p_items: items, p_type: type, p_note: note }),
  );
}

// ---------------------------------------------------------------- سجل الحركات (أدمن)
export const MOVEMENTS_PAGE_SIZE = 50;

export interface MovementFilters {
  type: MovementType | null;
  from: string | null; // YYYY-MM-DD (بغداد)
  to: string | null;
}

export interface Movement {
  id: number;
  qty: number;
  type: MovementType;
  unit_cost_iqd: number;
  note: string | null;
  created_at: string;
  order_id: string | null;
  by: string | null;
}

/** صفحة حركات (keyset بـ id تنازلياً). الأيام بتوقيت بغداد (+03:00، بلا توقيت صيفي). */
export async function fetchMovements(
  supabase: MukhdarClient,
  productId: string,
  filters: MovementFilters,
  beforeId: number | null,
): Promise<{ rows: Movement[]; next: number | null }> {
  let q = supabase
    .from('inventory_movements')
    .select('id, qty, type, unit_cost_iqd, note, created_at, order_id, profiles(full_name)')
    .eq('product_id', productId)
    .order('id', { ascending: false })
    .limit(MOVEMENTS_PAGE_SIZE);
  if (filters.type) q = q.eq('type', filters.type);
  if (filters.from) q = q.gte('created_at', `${filters.from}T00:00:00+03:00`);
  if (filters.to) q = q.lte('created_at', `${filters.to}T23:59:59.999+03:00`);
  if (beforeId !== null) q = q.lt('id', beforeId);
  const rows = await unwrap<Record<string, unknown>[]>(q);
  const mapped: Movement[] = rows.map((r) => ({
    id: r.id as number,
    qty: r.qty as number,
    type: r.type as MovementType,
    unit_cost_iqd: r.unit_cost_iqd as number,
    note: (r.note as string | null) ?? null,
    created_at: r.created_at as string,
    order_id: (r.order_id as string | null) ?? null,
    by: (r.profiles as { full_name: string | null } | null)?.full_name ?? null,
  }));
  const last = mapped.at(-1);
  return { rows: mapped, next: mapped.length === MOVEMENTS_PAGE_SIZE && last ? last.id : null };
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  purchase: 'مشتريات',
  sale: 'بيع',
  waste: 'هدر',
  adjust: 'تسوية جرد',
  cancel_return: 'إرجاع إلغاء',
};

// ---------------------------------------------------------------- هدر الأيام السابقة
export async function fetchWasteHistory(
  supabase: MukhdarClient,
  fromDay: string,
): Promise<{ day: string; waste_cost_iqd: number }[]> {
  return unwrap<{ day: string; waste_cost_iqd: number }[]>(
    supabase
      .from('daily_stats')
      .select('day, waste_cost_iqd')
      .gte('day', fromDay)
      .gt('waste_cost_iqd', 0)
      .order('day', { ascending: false }),
  );
}
