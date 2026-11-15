// ملخص السلة (T13، SPEC-customer §2.3): البنود بأحدث أسعار الكتالوج، المجموع الفرعي (مقرّب لأقرب 250 مثل
// place_order)، أجرة التوصيل والحد الأدنى من app_settings، وتعليم غير المتوفر.
// المجموع هنا تقديري للعرض فقط: المجموع الحقيقي يرجع من place_order.
import { roundIQD, type MukhdarClient } from '@mukhdar/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '../../lib/supabase';
import { catalogKeys, fetchProductsByIds, type Product } from '../catalog/api';
import { cachedProductMap } from '../catalog/cache';
import { type AppSettings, useAppSettings } from '../settings/useAppSettings';
import { type CartFlag, useCart } from './store';

/**
 * ok: متوفر. unavailable: موقوف أو غير متوفر (يمنع الطلب حتى يُحذف). insufficient: place_order رفض الكمية
 * (يمنع الطلب حتى تتغير الكمية). unknown: لا نعرف المنتج بعد (لا كاش ولا رد من الخلفية).
 */
export type LineStatus = 'ok' | 'unavailable' | 'insufficient' | 'unknown';

export interface CartLineView {
  id: string;
  qty: number;
  product: Product | null;
  lineTotal: number;
  status: LineStatus;
}

export interface CartSummary {
  lines: CartLineView[];
  /** عدد المنتجات (لا الوحدات) */
  count: number;
  subtotal: number;
  deliveryFee: number | null;
  total: number;
  minOrder: number;
  belowMin: boolean;
  /** بند غير متوفر أو بكمية مرفوضة: لا يُرسل الطلب */
  blocked: boolean;
  storeOpen: boolean;
}

export function summarizeCart(
  items: Record<string, number>,
  flags: Record<string, CartFlag>,
  fresh: Map<string, Product> | null,
  cached: Map<string, Product>,
  settings: Pick<AppSettings, 'delivery_fee_iqd' | 'min_order_iqd' | 'store_open'> | null,
): CartSummary {
  const lines = Object.entries(items).map(([id, qty]): CartLineView => {
    const product = (fresh ? fresh.get(id) : cached.get(id)) ?? cached.get(id) ?? null;
    let status: LineStatus;
    if (flags[id] === 'unavailable') status = 'unavailable';
    else if (fresh && !fresh.has(id))
      status = 'unavailable'; // أُوقف (RLS لا يرجعه)
    else if (!product) status = 'unknown';
    else if (!product.in_stock) status = 'unavailable';
    else if (flags[id] === 'insufficient') status = 'insufficient';
    else status = 'ok';
    const lineTotal = product && status !== 'unavailable' ? product.price_iqd * qty : 0;
    return { id, qty, product, lineTotal, status };
  });
  const subtotal = roundIQD(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const deliveryFee = settings?.delivery_fee_iqd ?? null;
  const minOrder = settings?.min_order_iqd ?? 0;
  return {
    lines,
    count: lines.length,
    subtotal,
    deliveryFee,
    total: subtotal + (deliveryFee ?? 0),
    minOrder,
    belowMin: lines.length > 0 && subtotal < minOrder,
    blocked: lines.some((l) => l.status === 'unavailable' || l.status === 'insufficient'),
    storeOpen: settings?.store_open ?? true,
  };
}

/** أحدث حالة لمنتجات السلة: تُطلب عند كل فتح للسلة أو التأكيد. */
export function useCartProducts(ids: string[]) {
  const client = getSupabase();
  return useQuery({
    queryKey: catalogKeys.cart(ids),
    queryFn: () => fetchProductsByIds(client as MukhdarClient, ids),
    enabled: client !== null && ids.length > 0,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useCartSummary() {
  const items = useCart((s) => s.items);
  const flags = useCart((s) => s.flags);
  const ids = Object.keys(items);
  const products = useCartProducts(ids);
  const settings = useAppSettings();
  const queryClient = useQueryClient();
  const fresh = products.data ? new Map(products.data.map((p) => [p.id, p])) : null;
  const summary = summarizeCart(
    items,
    flags,
    fresh,
    cachedProductMap(queryClient),
    settings.data ?? null,
  );
  return { summary, products, settings };
}
