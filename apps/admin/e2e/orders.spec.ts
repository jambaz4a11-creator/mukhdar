import { expect, test, type Page } from '@playwright/test';
import { pageAs } from './helpers';
import { ALLOW_WRITES, placeOrder } from './supabase';

// T17: صفحة الطلبات. القراءة تعمل على أي بيانات seed (محلياً ضد mukhdar-dev)؛ تدفقات الكتابة
// (طلب جديد حي، بدء تحضير، تعيين سائق، جاهز، إلغاء) فقط مع E2E_ALLOW_WRITES=1 (CI، Supabase محلي).

const TABS = [
  'pending',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const;

async function openOrders(page: Page, query = '') {
  await page.goto(`/orders${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'الطلبات' })).toBeVisible();
  await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live', {
    timeout: 15_000,
  });
}

async function countOf(page: Page, tab: (typeof TABS)[number]): Promise<number> {
  const el = page.getByTestId(`count-${tab}`);
  await expect(el).not.toHaveText('…');
  return Number(await el.innerText());
}

/** يفتح أول طلب بأول تبويب فيه طلبات؛ يرجع رقمه أو null إن لم توجد طلبات. */
async function openFirstOrder(page: Page): Promise<number | null> {
  for (const tab of TABS) {
    if ((await countOf(page, tab)) === 0) continue;
    await page.locator(`[data-tab="${tab}"]`).click();
    const first = page.getByTestId('orders-table').locator('tbody tr').first();
    await expect(first).toBeVisible();
    const num = Number(await first.getAttribute('data-order-number'));
    await first.getByRole('button').click();
    await expect(page.getByTestId('order-detail')).toBeVisible();
    return num;
  }
  return null;
}

test.describe.serial('orders (admin, read)', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
  });
  test.afterAll(async () => page.context().close());

  test('status tabs with counts', async () => {
    await openOrders(page);
    for (const tab of TABS) {
      expect(await countOf(page, tab)).toBeGreaterThanOrEqual(0);
    }
    await expect(page.locator('[data-tab="delivered"]')).toContainText('مسلّم اليوم');
  });

  test('details: customer, address, items, history, and cost/profit for admin', async () => {
    await openOrders(page);
    const num = await openFirstOrder(page);
    test.skip(num === null, 'no orders in this database');
    const panel = page.getByTestId('order-detail');
    await expect(panel.getByRole('heading', { name: `الطلب #${num}` })).toBeVisible();
    await expect(panel.getByTestId('order-address')).toContainText('قطاع');
    await expect(panel.getByTestId('order-address')).toContainText('عمارة');
    await expect(panel.getByTestId('customer-phone')).toHaveText(/^07\d{9}$/);
    await expect(panel.getByRole('link', { name: 'اتصال' })).toHaveAttribute(
      'href',
      /^tel:\+9647\d{9}$/,
    );
    await expect(panel.getByRole('link', { name: 'واتساب' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/9647\d{9}$/,
    );
    await expect(panel.getByTestId('order-item').first()).toBeVisible();
    await expect(panel.getByTestId('status-history').locator('li').first()).toBeVisible();
    await expect(panel.getByTestId('order-profit')).toBeVisible();
  });

  test('search by order number and by customer phone', async () => {
    await openOrders(page);
    const num = await openFirstOrder(page);
    test.skip(num === null, 'no orders in this database');
    const phone = await page.getByTestId('customer-phone').innerText();
    const search = page.getByRole('searchbox');

    await search.fill(`#${num}`);
    const rows = page.getByTestId('orders-table').locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-order-number', String(num));

    await search.fill(phone);
    await expect(
      page.getByTestId('orders-table').locator(`tbody tr[data-order-number="${num}"]`),
    ).toBeVisible();

    await search.fill('أحمد');
    await expect(page.getByText('اكتب رقم طلب')).toBeVisible();
    await search.fill('');
  });

  test('rapid filter changes never revert each other; a tab click beats a pending search (M2)', async () => {
    await openOrders(page, '?tab=delivered');
    const select = page.getByLabel('فلتر السائق');
    await expect(select.locator('option').nth(1)).toBeAttached();
    const driverId = (await select.locator('option').nth(1).getAttribute('value')) ?? '';
    const day = '2026-11-10';
    // سائق ثم يوم بلا انتظار بينهما: الاثنان بالرابط
    await select.selectOption(driverId);
    await page.getByLabel('التاريخ').fill(day);
    await expect
      .poll(
        () =>
          new URL(page.url()).searchParams.get('driver') +
          '|' +
          new URL(page.url()).searchParams.get('day'),
      )
      .toBe(driverId + '|' + day);

    // نكتب بحثاً ثم ننقر تبويباً خلال 300ms: التبويب يفوز، ومربع البحث فارغ، والسائق باقٍ
    const search = page.getByRole('searchbox');
    await search.fill('#12345');
    await page.locator('[data-tab="cancelled"]').click();
    await page.waitForTimeout(800); // أكثر من مهلة البحث (350ms): المؤقت المتأخر لا يغيّر شيئاً
    const sp = new URL(page.url()).searchParams;
    expect(sp.get('tab')).toBe('cancelled');
    expect(sp.get('q')).toBeNull();
    await expect(search).toHaveValue('');
  });

  test('driver filter limits rows to that driver', async () => {
    await openOrders(page, '?tab=delivered');
    const select = page.getByLabel('فلتر السائق');
    const options = select.locator('option');
    await expect(options.nth(1)).toBeAttached();
    const label = (await options.nth(1).innerText()).trim();
    await select.selectOption({ index: 1 });
    await expect(page).toHaveURL(/driver=/);
    const cells = page.getByTestId('orders-table').locator('tbody tr td:nth-child(6)');
    const n = await cells.count();
    for (let i = 0; i < n; i++)
      await expect(cells.nth(i)).toHaveText(label.replace(' (معطّل)', ''));
  });

  test('print opens an 80mm receipt', async () => {
    await openOrders(page);
    const num = await openFirstOrder(page);
    test.skip(num === null, 'no orders in this database');
    const [receipt] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('order-detail').getByRole('link', { name: 'طباعة' }).click(),
    ]);
    await receipt.evaluate(() => {
      window.print = () => undefined;
    });
    await expect(receipt.getByTestId('receipt')).toContainText(`طلب #${num}`);
    await expect(receipt.getByTestId('receipt')).not.toContainText('الربح');
    await receipt.close();
  });
});

test('staff: details without cost or profit, and order_item_costs is never requested', async ({
  browser,
}) => {
  const page = await pageAs(browser, 'staff');
  const costRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('order_item_costs')) costRequests.push(r.url());
  });
  await openOrders(page);
  const num = await openFirstOrder(page);
  test.skip(num === null, 'no orders in this database');
  await expect(page.getByTestId('order-item').first()).toBeVisible();
  await expect(page.getByTestId('order-profit')).toHaveCount(0);
  await expect(page.getByText('التكلفة / الربح')).toHaveCount(0);
  expect(costRequests).toEqual([]);
  await page.context().close();
});

test.describe.serial('orders (writes: live order and actions)', () => {
  test.skip(!ALLOW_WRITES, 'writes only against a local Supabase (E2E_ALLOW_WRITES=1)');
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'staff');
  });
  test.afterAll(async () => page.context().close());

  test('a new order arrives live: alert, badge, and on top of "new"', async () => {
    await openOrders(page, '?tab=pending');
    const before = await countOf(page, 'pending');
    const badge = page.getByTestId('orders-badge');
    const badgeBefore = (await badge.count()) ? Number(await badge.innerText()) : 0;

    const order = await placeOrder();
    const firstRow = page.getByTestId('orders-table').locator('tbody tr').first();
    await expect(firstRow).toHaveAttribute('data-order-number', String(order.order_number), {
      timeout: 5_000,
    });
    await expect(page.locator('html')).toHaveAttribute('data-new-order-alerts', /[1-9]/);
    await expect(page.getByTestId('count-pending')).toHaveText(String(before + 1));
    await expect(badge).toHaveText(String(badgeBefore + 1));
  });

  test('start preparing → assign driver → ready → fallback out for delivery → delivered', async () => {
    const order = await placeOrder();
    await openOrders(page, `?tab=pending&q=${order.order_number}`);
    await page.getByRole('button', { name: `الطلب رقم ${order.order_number}` }).click();
    const panel = page.getByTestId('order-detail');

    await panel.getByRole('button', { name: 'بدء التحضير' }).click();
    await expect(panel.locator('[data-status="preparing"]')).toBeVisible();

    const select = panel.getByLabel('تعيين سائق');
    // أول سائق قابل للتعيين: من لم يغيّر رمزه المؤقت (حسابات الاختبارات الأخرى) يظهر معطّلاً (M1)
    const firstAssignable = await select
      .locator('option:not([disabled]):not([value=""])')
      .first()
      .getAttribute('value');
    await select.selectOption(firstAssignable ?? '');
    const driverName = (await select.locator('option:checked').innerText()).trim();
    await panel.getByRole('button', { name: 'تعيين', exact: true }).click();
    await expect(panel.getByText(`السائق: ${driverName}`)).toBeVisible();
    // UPDATE حي: صف الجدول يعرض السائق
    await expect(
      page
        .getByTestId('orders-table')
        .locator(`tr[data-order-number="${order.order_number}"] td:nth-child(6)`),
    ).toHaveText(driverName);

    await panel.getByRole('button', { name: 'الطلب جاهز' }).click();
    await expect(panel.locator('[data-status="ready"]')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'بدء التحضير' })).toHaveCount(0);

    // احتياطي بدل السائق (2026-11-16): بالطريق ثم تم التوصيل، بتأكيد
    page.on('dialog', (d) => void d.accept());
    await panel.getByRole('button', { name: 'بالطريق (بدل السائق)' }).click();
    await expect(panel.locator('[data-status="out_for_delivery"]')).toBeVisible();
    await panel.getByRole('button', { name: 'تم التوصيل (بدل السائق)' }).click();
    await expect(panel.locator('[data-status="delivered"]')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'إلغاء الطلب' })).toHaveCount(0);
  });

  test('fallback out-for-delivery is disabled until a driver is assigned', async () => {
    const order = await placeOrder();
    await openOrders(page, `?q=${order.order_number}&order=${order.id}`);
    const panel = page.getByTestId('order-detail');
    await panel.getByRole('button', { name: 'بدء التحضير' }).click();
    await expect(panel.locator('[data-status="preparing"]')).toBeVisible();
    await panel.getByRole('button', { name: 'الطلب جاهز' }).click();
    await expect(panel.locator('[data-status="ready"]')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'بالطريق (بدل السائق)' })).toBeDisabled();
    await expect(panel.getByText('عيّن سائقاً أولاً')).toBeVisible();
  });

  test('cancel with a reason', async () => {
    const order = await placeOrder();
    await openOrders(page, `?q=${order.order_number}&order=${order.id}`);
    const panel = page.getByTestId('order-detail');
    await panel.getByRole('button', { name: 'إلغاء الطلب' }).click();
    const confirm = panel.getByRole('button', { name: 'تأكيد الإلغاء' });
    await expect(confirm).toBeDisabled(); // السبب إلزامي
    await panel.getByLabel('سبب الإلغاء (يصل للزبون)').fill('المنتج نفد');
    await confirm.click();
    await expect(panel.locator('[data-status="cancelled"]')).toBeVisible();
    await expect(panel.getByTestId('cancel-reason')).toContainText('المنتج نفد');
    await expect(panel.getByRole('button', { name: 'إلغاء الطلب' })).toHaveCount(0);
  });
});
