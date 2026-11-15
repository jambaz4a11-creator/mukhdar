// قراءة الكتالوج من Supabase (T11، SPEC-customer §2.2). القراءة مسموحة للجميع بـ RLS (المنتجات النشطة فقط).
// الأسعار هنا للعرض فقط: المجموع الحقيقي يُحسب داخل place_order.
import type { MukhdarClient } from '@mukhdar/shared';

export const PAGE_SIZE = 30;
export const SEARCH_LIMIT = 30;

export interface Category {
  id: number;
  name: string;
  sort_order: number;
}

export interface Product {
  id: string;
  category_id: number;
  name: string;
  description: string | null;
  unit: string;
  price_iqd: number;
  image_path: string | null;
  in_stock: boolean;
  sort_order: number;
}

const PRODUCT_COLUMNS =
  'id, category_id, name, description, unit, price_iqd, image_path, in_stock, sort_order';

export const catalogKeys = {
  categories: ['categories'] as const,
  /** كل استعلامات المنتجات تبدأ بـ 'products' (cache.ts يبحث فيها عن منتج بالـ id). */
  products: ['products'] as const,
  list: (categoryId: number | null) => ['products', 'list', categoryId] as const,
  search: (term: string) => ['products', 'search', term] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
  /** منتجات السلة بأحدث حالة (T13): المنتج الموقوف لا يرجع (RLS)، فيُعلَّم غير متوفر. */
  cart: (ids: string[]) => ['products', 'cart', [...ids].sort().join(',')] as const,
};

export async function fetchCategories(client: MukhdarClient): Promise<Category[]> {
  const { data, error } = await client
    .from('categories')
    .select('id, name, sort_order')
    .eq('is_active', true)
    .order('sort_order')
    .order('id');
  if (error) throw error;
  return data;
}

/** صفحة رقم page (من 0): الصفوف [page*30, page*30+29] بترتيب sort_order ثم id. */
export async function fetchProductsPage(
  client: MukhdarClient,
  categoryId: number | null,
  page: number,
): Promise<Product[]> {
  let q = client.from('products').select(PRODUCT_COLUMNS).eq('is_active', true);
  if (categoryId !== null) q = q.eq('category_id', categoryId);
  const from = page * PAGE_SIZE;
  const { data, error } = await q
    .order('sort_order')
    .order('id')
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return data;
}

/** صفحة كاملة (30) تعني احتمال وجود صفحة بعدها؛ أقل من ذلك = النهاية. */
export function nextPageParam(lastPage: Product[], allPages: Product[][]): number | undefined {
  return lastPage.length < PAGE_SIZE ? undefined : allPages.length;
}

/** يهرّب محارف LIKE (% و _ و \) حتى يُبحث عن النص كما كُتب. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchProducts(client: MukhdarClient, term: string): Promise<Product[]> {
  const { data, error } = await client
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('is_active', true)
    .ilike('name', `%${escapeLike(term)}%`)
    .order('sort_order')
    .order('id')
    .limit(SEARCH_LIMIT);
  if (error) throw error;
  return data;
}

export async function fetchProduct(client: MukhdarClient, id: string): Promise<Product | null> {
  const { data, error } = await client
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** رابط الصورة العامة من bucket product-images؛ null = صورة بديلة (لا توجد صور حقيقية بعد). */
export function productImageUrl(client: MukhdarClient | null, path: string | null): string | null {
  if (!client || !path) return null;
  return client.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

/** أحدث حالة لمنتجات السلة (السعر والتوفر). المنتج غير النشط لا يرجع. */
export async function fetchProductsByIds(client: MukhdarClient, ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('products')
    .select(PRODUCT_COLUMNS)
    .in('id', ids)
    .eq('is_active', true);
  if (error) throw error;
  return data;
}
