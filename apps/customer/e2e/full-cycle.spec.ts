// فحص النسخة المنشورة كاملاً (2026-11-18، docs/reviews/preview-check.md): دورة طلب حقيقية بكل الأدوار على mukhdar-dev.
// زبون (PWA، WebKit أو Chromium) يسجّل ← الاسم ← عنوان بالطابق ← يتصفح ← السلة ← يؤكد الطلب؛ الأدمن يراه حياً
// (اللوحة المنشورة)؛ الموظف يحضّره ← جاهز؛ السائق (تطبيقه خارجي: نفس دوال DRIVER-API بجلسته) يقبله ← بالطريق ←
// تم التوصيل؛ الزبون يقيّم؛ أرقام الرئيسية والتقارير تتحدث؛ الزبون يحذف حسابه والطلب يبقى مجهّلاً.
// اختياري: E2E_FULL_CYCLE=1 (يترك طلباً مسلّماً مجهّلاً بلا بيانات شخصية على dev، وينقص مخزون منتج واحد بوحدة).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { validatePin } from '@mukhdar/shared';
import { ACCOUNTS, DRIVER_PIN, PIN } from '../../admin/e2e/accounts';
import { DEV_TOTP_SECRET, freshTotp } from '../../admin/e2e/totp';
import { E2E_PHONE_PREFIX, PUBLISHABLE_KEY, SERVICE_KEY, SUPABASE_URL, assertDev } from './env';

const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'https://mukhdar-admin.jambaz4a11.workers.dev';
/** سائق عرض بلا طلبات جارية على dev (07000000012). */
const DRIVER_PHONE = process.env.E2E_DRIVER_PHONE ?? '07000000012';
const NAME = 'زبون الفحص الكامل';
const SHOTS = process.env.E2E_SHOTS;

test.skip(
  process.env.E2E_FULL_CYCLE !== '1',
  'opt-in: E2E_FULL_CYCLE=1 (writes a delivered order)',
);
test.setTimeout(420_000);

function newCredentials() {
  const phone = `${E2E_PHONE_PREFIX}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  const randomPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
  let pin = randomPin();
  while (validatePin(pin, phone) !== null) pin = randomPin();
  return { phone, local: `0${phone.slice(3)}`, pin };
}

/** "12,500 د.ع" ← 12500 */
function iqd(text: string): number {
  return Number(text.replace(/[^\d-]/g, ''));
}

async function shot(page: Page, name: string) {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-full-${name}.png` });
  }
}

/** REST بلا مكتبة (مثل global-teardown): مفتاح الخدمة للقراءة بالفحص فقط، وجلسة السائق لدواله. */
async function rest<T>(path: string, token: string, apikey: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      apikey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface OrderRow {
  status: string;
  order_number: number;
  subtotal_iqd: number;
  customer_name: string | null;
  customer_phone: string | null;
  address_snapshot: Record<string, unknown>;
}

/** قراءة الطلب بمفتاح الخدمة (Node فقط، للتحقق). */
async function readOrder(id: string): Promise<OrderRow> {
  const key = SERVICE_KEY ?? '';
  const rows = await rest<OrderRow[]>(
    `/rest/v1/orders?id=eq.${id}&select=status,order_number,subtotal_iqd,customer_name,customer_phone,address_snapshot`,
    key,
    key,
  );
  const row = rows[0];
  if (!row) throw new Error(`order ${id} not found`);
  return row;
}

/** جلسة السائق كما يفتحها تطبيقه: الهاتف + PIN (السائق بلا عامل TOTP)، ثم دوال DRIVER-API. */
async function driverSession() {
  const apikey = PUBLISHABLE_KEY ?? '';
  const { access_token: token } = await rest<{ access_token: string }>(
    '/auth/v1/token?grant_type=password',
    apikey,
    apikey,
    { phone: `+964${DRIVER_PHONE.slice(1)}`, password: DRIVER_PIN },
  );
  return {
    rpc: <T>(fn: string, args: Record<string, unknown> = {}) =>
      rest<T>(`/rest/v1/rpc/${fn}`, token, apikey, args),
    get: <T>(path: string) => rest<T>(path, token, apikey),
    signOut: () => rest('/auth/v1/logout', token, apikey, {}),
  };
}

/** لوحة الأدمن المنشورة بدور معيّن (الهاتف + PIN + رمز تطبيق المصادقة). */
async function panelAs(browser: Browser, phone: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: ADMIN_URL,
    viewport: { width: 1366, height: 900 },
    locale: 'ar-IQ',
  });
  const page = await context.newPage();
  await gotoPanel(page, '/login');
  await expect(page.locator('form[data-ready="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('رقم الهاتف').fill(phone);
  await page.getByLabel('رمز الدخول (PIN)').fill(PIN);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/mfa');
  await page.getByLabel('رمز تطبيق المصادقة').fill(await freshTotp(DEV_TOTP_SECRET));
  await page.getByRole('button', { name: /^(دخول|تفعيل ودخول)$/ }).click();
  await page.waitForURL((u) => u.pathname === '/');
  return page;
}

/**
 * WebKit (بناء Playwright على ويندوز) يؤجل تحميل صفحة بنافذة بالخلفية لدقائق بينما صفحة الزبون بالواجهة؛
 * فتُقدَّم صفحة اللوحة قبل كل تنقل (ما يفعله المستخدم بالتبديل للتبويب). docs/reviews/preview-check.md.
 */
async function focus(panel: Page) {
  await panel.bringToFront();
}

/** صفحات اللوحة المنشورة: Cloudflare 1102 (حد موارد الـ Worker، docs/OPEN-QUESTIONS.md) ← إعادة المحاولة وتسجيلها. */
let worker1102 = 0;
async function gotoPanel(panel: Page, path: string) {
  for (let attempt = 1; ; attempt++) {
    const res = await panel.goto(path, { timeout: 60_000 });
    const body = res && res.status() === 503 ? await panel.content() : '';
    if (!/1102/.test(body)) return;
    worker1102++;
    if (attempt >= 8) throw new Error(`admin Worker 1102 on ${path} ${attempt} times`);
    await panel.waitForTimeout(1_500);
  }
}

async function openHomeCards(admin: Page) {
  await focus(admin);
  await gotoPanel(admin, '/');
  await expect(admin.getByTestId('kpi-delivered-value')).toBeVisible({ timeout: 30_000 });
  return {
    delivered: Number(await admin.getByTestId('kpi-delivered-value').innerText()),
    placed: Number(await admin.getByTestId('kpi-placed-value').innerText()),
    sales: iqd(await admin.getByTestId('kpi-sales-value').innerText()),
  };
}

async function openOrder(panel: Page, orderNumber: number, orderId: string) {
  await focus(panel);
  await gotoPanel(panel, `/orders?q=${orderNumber}&order=${orderId}`);
  await expect(panel.getByRole('heading', { level: 1, name: 'الطلبات' })).toBeVisible();
  await expect(panel.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live', {
    timeout: 20_000,
  });
  return panel.getByTestId('order-detail');
}

test('preview: customer → admin → staff → driver → rating → reports → delete account', async ({
  page,
  browser,
}) => {
  assertDev();
  page.on('dialog', (d) => void d.accept());
  const c = newCredentials();
  let orderId = '';
  let orderNumber = 0;
  let subtotal = 0;

  const admin = await panelAs(browser, ACCOUNTS.admin);
  const before = await openHomeCards(admin);
  await page.bringToFront();

  await test.step('customer: sign up → name → address with floor', async () => {
    await page.goto('/auth/sign-up');
    await page.getByTestId('phone-input').fill(c.local);
    await page.getByTestId('pin-input').fill(c.pin);
    await page.getByTestId('pin-confirm-input').fill(c.pin);
    await page.getByTestId('sign-up-submit').click();
    await page.getByTestId('name-input').fill(NAME);
    await page.getByTestId('name-submit').click();
    await page.getByTestId('block-select').click();
    await page.getByTestId('block-list').getByRole('button', { name: 'A1', exact: true }).click();
    await page.getByTestId('building-input').fill('1');
    await expect(page.getByTestId('building-found')).toBeVisible();
    await page.getByTestId('floor-input').fill('3');
    await page.getByTestId('apartment-input').fill('12');
    await page.getByTestId('address-save').click();
    await expect(page.getByTestId('delivery-address')).toBeVisible({ timeout: 30_000 });
  });

  await test.step('customer: browse → cart → checkout', async () => {
    await page
      .getByRole('button', { name: /^أضف .+ للسلة$/ })
      .first()
      .click();
    await page.getByTestId('cart-bar').click();
    await page.getByTestId('cart-continue').click();
    await page.getByTestId('checkout-confirm').click();
    await expect(page.getByTestId('order-hero')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('order-address')).toContainText('طابق 3 · شقة 12');
    orderId = /\/order\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    expect(orderId).not.toBe('');
    const row = await readOrder(orderId);
    orderNumber = Number(row.order_number);
    subtotal = Number(row.subtotal_iqd);
    expect(row.address_snapshot.floor).toBe(3);
  });

  await test.step('admin sees the new order live, with the floor', async () => {
    await expect(admin.getByTestId('kpi-placed-value')).toHaveText(String(before.placed + 1), {
      timeout: 20_000,
    });
    const panel = await openOrder(admin, orderNumber, orderId);
    await expect(panel.locator('[data-status="pending"]')).toBeVisible();
    await expect(panel).toContainText('طابق 3');
    await expect(panel).toContainText(NAME);
    await shot(admin, 'admin-order');
  });

  const staff = await panelAs(browser, ACCOUNTS.staff);
  await test.step('staff: preparing → ready', async () => {
    const panel = await openOrder(staff, orderNumber, orderId);
    await panel.getByRole('button', { name: 'بدء التحضير' }).click();
    await expect(panel.locator('[data-status="preparing"]')).toBeVisible();
    await panel.getByRole('button', { name: 'الطلب جاهز' }).click();
    await expect(panel.locator('[data-status="ready"]')).toBeVisible();
    await page.bringToFront();
    await expect(page.getByTestId('order-hero')).toContainText('جاهز', { timeout: 30_000 });
  });

  await test.step('driver: accept → out for delivery → delivered (DRIVER-API calls)', async () => {
    const driver = await driverSession();
    const available = await driver.rpc<{ id: string }[]>('available_orders');
    expect(available.some((o) => o.id === orderId)).toBe(true);
    // قبل القبول: لا شقة ولا طابق بالقائمة
    const listed = available.find((o) => o.id === orderId) as Record<string, unknown>;
    expect(JSON.stringify(listed)).not.toContain('"floor"');
    await driver.rpc('accept_order', { p_order_id: orderId });
    // بعد القبول: السائق يقرأ الطلب كاملاً، والطابق باللقطة
    const mine = await driver.get<{ address_snapshot: Record<string, unknown> }[]>(
      `/rest/v1/orders?id=eq.${orderId}&select=address_snapshot`,
    );
    expect(mine[0]?.address_snapshot.floor).toBe(3);
    for (const status of ['out_for_delivery', 'delivered']) {
      await driver.rpc('set_order_status', { p_order_id: orderId, p_status: status });
    }
    await driver.signOut();
  });

  await test.step('customer: sees delivered and rates', async () => {
    await page.bringToFront();
    await expect(page.getByTestId('order-rate')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('order-rate').click();
    await page.getByTestId('rate-star-5').click();
    await page.getByTestId('rate-comment').fill('ممتاز، فحص كامل');
    await page.getByTestId('rate-submit').click();
    await expect(page.getByTestId('rate-thanks')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('rate-done').click();
    await expect(page.getByTestId('order-rated')).toBeVisible({ timeout: 20_000 });
  });

  await test.step('admin: home cards and today report include the delivery', async () => {
    const after = await openHomeCards(admin);
    expect(after.delivered).toBe(before.delivered + 1);
    expect(after.sales).toBe(before.sales + subtotal);
    await shot(admin, 'admin-home');
    await gotoPanel(admin, '/reports');
    await admin.getByRole('button', { name: 'اليوم', exact: true }).click();
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10); // بغداد UTC+3
    await expect(admin.getByTestId('report-range')).toContainText(today);
    await expect(admin.getByTestId('kpi-sales-value')).toHaveText(/د\.ع/);
    expect(iqd(await admin.getByTestId('kpi-sales-value').innerText())).toBe(after.sales);
    expect(Number(await admin.getByTestId('kpi-delivered-value').innerText())).toBe(
      after.delivered,
    );
  });

  await test.step('customer: delete account → order kept, anonymized', async () => {
    await page.bringToFront();
    await page.goto('/account');
    await page.getByTestId('delete-account').click();
    await expect(page.getByTestId('delete-account')).toHaveCount(0, { timeout: 30_000 });
    const row = await readOrder(orderId);
    expect(row.status).toBe('delivered');
    expect(row.customer_name).toBeNull();
    expect(row.customer_phone).toBeNull();
    expect(Object.keys(row.address_snapshot).sort()).toEqual(['sector', 'subsection']);
  });

  test.info().annotations.push({ type: 'order', description: `#${orderNumber} ${orderId}` });
  test.info().annotations.push({ type: 'worker-1102-retries', description: String(worker1102) });
  console.log(`[full-cycle] order #${orderNumber}; admin Worker 1102 retries: ${worker1102}`);
  await staff.context().close();
  await admin.context().close();
});
