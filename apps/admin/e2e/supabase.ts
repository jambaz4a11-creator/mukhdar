// عميل Supabase للاختبارات (Node): إنشاء طلب كزبون العرض. الكتابة فقط حيث E2E_ALLOW_WRITES=1
// (CI ضد Supabase محلي)، فلا تُعدَّل بيانات mukhdar-dev من الاختبارات المحلية.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinFor } from './accounts';
import { DEV_TOTP_SECRET, freshTotp } from './totp';

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

export async function signedInClient(
  phone: string,
  pin = pinFor(phone),
  mfaSecret = DEV_TOTP_SECRET,
): Promise<SupabaseClient> {
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
  // T23 C1: حساب له عامل TOTP (الأدمن والموظف) ← aal2 برمز التطبيق، وإلا دوال الدور ترفض
  const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    const { data: factors, error: fe } = await client.auth.mfa.listFactors();
    const factorId = factors?.totp[0]?.id;
    if (fe || !factorId) throw fe ?? new Error(`no verified TOTP factor for ${phone}`);
    const { error: ve } = await client.auth.mfa.challengeAndVerify({
      factorId,
      code: await freshTotp(mfaSecret),
    });
    if (ve) throw ve;
  }
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
    const { data: settings } = await client
      .from('app_settings')
      .select('min_order_iqd, max_line_qty')
      .limit(1);
    const minOrder = Number(settings?.[0]?.min_order_iqd ?? 0);
    const maxLine = Number(settings?.[0]?.max_line_qty ?? 20); // T23 H2
    const { data: products } = await client
      .from('products')
      .select('id, price_iqd')
      .eq('in_stock', true)
      .order('price_iqd', { ascending: false })
      .limit(1);
    const product = products?.[0] as { id: string; price_iqd: number } | undefined;
    if (!product) throw new Error('no product in stock for e2e');
    const qty = Math.min(maxLine, Math.max(1, Math.ceil(minOrder / product.price_iqd)));
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

/** يقود طلباً بالمسار الحقيقي حتى "تم التوصيل" بدوال الأدمن (تعيين أول سائق قابل للتعيين). */
export async function deliverOrder(admin: SupabaseClient, orderId: string): Promise<void> {
  const { data: drivers, error: dErr } = await admin.rpc('list_drivers');
  if (dErr) throw dErr;
  const driver = (drivers as { id: string; is_active: boolean; must_change_pin: boolean }[]).find(
    (x) => x.is_active && !x.must_change_pin,
  );
  if (!driver) throw new Error('no assignable demo driver for e2e');
  for (const step of ['preparing', 'assign', 'ready', 'out_for_delivery', 'delivered']) {
    const { error } =
      step === 'assign'
        ? await admin.rpc('assign_driver', { p_order_id: orderId, p_driver_id: driver.id })
        : await admin.rpc('set_order_status', { p_order_id: orderId, p_status: step });
    if (error) throw new Error(`${step}: ${error.message}`);
  }
}

export interface SeededDriverRequest {
  id: string;
  /** 07XXXXXXXXX كما يُعرض باللوحة */
  phone: string;
  name: string;
}

/**
 * يزرع طلب تسجيل سائق **بالمسار الحقيقي**: Edge Function driver-register (بلا حساب، anon كتطبيق السائق).
 * لا مفتاح خادم باللوحة ولا باختباراتها (noServiceRole.test.ts)، فلا تجهيز بدور خدمة. أرقام 07009xxxxxx
 * عشوائية (غير أرقام العرض)، والكتابة فقط مع E2E_ALLOW_WRITES (Supabase محلي).
 */
export async function seedDriverRequest(label: string): Promise<SeededDriverRequest> {
  if (!ALLOW_WRITES) throw new Error('seedDriverRequest needs E2E_ALLOW_WRITES=1');
  const { url, key } = env();
  const phone = `07009${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
  const name = `سائق اختبار ${label}`;
  const res = await fetch(`${url}/functions/v1/driver-register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key },
    body: JSON.stringify({
      full_name: name,
      phone,
      device_secret: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    }),
  });
  const body = (await res.json()) as { request_id?: string; error?: string };
  if (res.status !== 201 || !body.request_id) {
    throw new Error(`driver-register ${res.status}: ${body.error ?? 'no request_id'}`);
  }
  return { id: body.request_id, phone, name };
}
