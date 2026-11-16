// عميل Supabase للاختبارات (Node): إنشاء طلب كزبون العرض. الكتابة فقط حيث E2E_ALLOW_WRITES=1
// (CI ضد Supabase محلي)، فلا تُعدَّل بيانات mukhdar-dev من الاختبارات المحلية.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PIN } from './accounts';

export const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === '1';

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY missing for e2e');
  return { url, key };
}

/** زائر بلا جلسة (ما يراه تطبيق الزبون قبل الدخول). */
export function anonClient(): SupabaseClient {
  const { url, key } = env();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function signedInClient(phone: string, pin = PIN): Promise<SupabaseClient> {
  const { url, key } = env();
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // 07XXXXXXXXX ← +9647XXXXXXXXX (أرقام العرض صالحة دائماً)
  const { error } = await client.auth.signInWithPassword({
    phone: `+964${phone.slice(1)}`,
    password: pin,
  });
  if (error) throw error;
  return client;
}

export interface PlacedOrder {
  id: string;
  order_number: number;
  customerPhone: string;
}

/** زبائن العرض 07000000101.. (seed:demo). يجرّب زبوناً بعد آخر إن بلغ حد الطلبات المفتوحة. */
const CUSTOMER_PHONES = Array.from({ length: 12 }, (_, i) => `07000000${String(101 + i)}`);
let nextCustomer = 0;
const clients = new Map<string, SupabaseClient>();

export async function placeOrder(note = 'طلب اختبار Playwright'): Promise<PlacedOrder> {
  for (let attempt = 0; attempt < CUSTOMER_PHONES.length; attempt++) {
    const phone = CUSTOMER_PHONES[(nextCustomer + attempt) % CUSTOMER_PHONES.length] ?? '';
    let client = clients.get(phone);
    if (!client) {
      client = await signedInClient(phone);
      clients.set(phone, client);
    }
    const { data: addr } = await client
      .from('addresses')
      .select('id')
      .order('is_default', { ascending: false })
      .limit(1);
    const addressId = addr?.[0]?.id as string | undefined;
    if (!addressId) continue;
    const { data: settings } = await client.from('app_settings').select('min_order_iqd').limit(1);
    const minOrder = Number(settings?.[0]?.min_order_iqd ?? 0);
    const { data: products } = await client
      .from('products')
      .select('id, price_iqd')
      .eq('in_stock', true)
      .order('price_iqd', { ascending: false })
      .limit(1);
    const product = products?.[0] as { id: string; price_iqd: number } | undefined;
    if (!product) throw new Error('no product in stock for e2e');
    const qty = Math.min(99, Math.max(1, Math.ceil(minOrder / product.price_iqd)));
    const { data, error } = await client.rpc('place_order', {
      p_address_id: addressId,
      p_items: [{ product_id: product.id, qty }],
      p_idempotency_key: crypto.randomUUID(),
      p_note: note,
    });
    if (error?.message === 'TOO_MANY_ACTIVE_ORDERS') continue;
    if (error) throw new Error(`place_order: ${error.message} ${error.details ?? ''}`);
    nextCustomer = (nextCustomer + attempt + 1) % CUSTOMER_PHONES.length;
    const r = data as { order_id: string; order_number: number };
    return { id: r.order_id, order_number: r.order_number, customerPhone: phone };
  }
  throw new Error('every demo customer is at the open-orders limit');
}
