import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNTS } from './accounts';
import { pageAs } from './helpers';
import { ALLOW_WRITES, placeOrder, signedInClient } from './supabase';

// T25: الرئيسية. البطاقات = dashboard_today() (قاعدة البيانات تحسب، الصفحة تعرض) للأدمن والموظف؛ الموظف بلا
// أي مبلغ (الدالة نفسها ترجع المال null)؛ الأرقام الكبيرة كاملة؛ الجدول = طلبات اليوم بالقاعدة. الكتابة
// (طلب حي ثم تسليمه) فقط مع E2E_ALLOW_WRITES=1 (CI، Supabase محلي).

/** نفس formatIQD (packages/shared): "12,500 د.ع". الحزمة CommonJS فلا تُستورد بـ Playwright ESM. */
function formatIQD(n: number): string {
  return `${n < 0 ? '-' : ''}${Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')} د.ع`;
}

type Dash = Record<string, number | null | Record<string, number> | unknown[]>;

async function dashboard(client: SupabaseClient): Promise<Dash> {
  const { data, error } = await client.rpc('dashboard_today');
  if (error) throw error;
  return data as Dash;
}

function num(v: unknown): number {
  return Number(v);
}

/** يوم بغداد الحالي (UTC+3 بلا توقيت صيفي). */
function baghdadDay(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** عدد طلبات اليوم بغداد مباشرة من الجدول (مستقل عن الدالة). */
async function placedTodayFromTable(client: SupabaseClient): Promise<number> {
  const day = baghdadDay();
  const from = new Date(`${day}T00:00:00+03:00`).toISOString();
  const to = new Date(new Date(`${day}T00:00:00+03:00`).getTime() + 86_400_000).toISOString();
  const { count, error } = await client
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', from)
    .lt('created_at', to);
  if (error) throw error;
  return count ?? 0;
}

async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('kpi-delivered-value')).toBeVisible();
  await expect(page.getByTestId('orders-table')).toBeVisible();
}

/** "▲ 5 عن أمس لنفس الساعة" كما تعرضه الصفحة لفرق عددي (cur - prev). */
function countDeltaText(cur: number, prev: number): string {
  const d = cur - prev;
  return d === 0 ? 'مثل أمس لنفس الساعة' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} عن أمس لنفس الساعة`;
}

async function expectCounts(page: Page, d: Dash) {
  await expect(page.getByTestId('kpi-delivered-value')).toHaveText(String(d.delivered_count));
  await expect(page.getByTestId('kpi-cancelled-value')).toHaveText(String(d.cancelled_count));
  await expect(page.getByTestId('kpi-placed-value')).toHaveText(String(d.placed_count));
  await expect(page.getByTestId('kpi-low-value')).toHaveText(String(d.low_stock_count));
  const open = d.open as Record<string, number>;
  for (const k of ['pending', 'preparing', 'ready', 'out_for_delivery']) {
    await expect(page.getByTestId(`open-${k}-value`)).toHaveText(String(open[k]));
  }
}

test.describe.serial('home (admin)', () => {
  let page: Page;
  let client: SupabaseClient;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
    client = await signedInClient(ACCOUNTS.admin);
  });
  test.afterAll(async () => page.context().close());

  test('every card equals dashboard_today(), in the design order', async () => {
    await openHome(page);
    const d = await dashboard(client);
    await expectCounts(page, d);
    await expect(page.getByTestId('kpi-sales-value')).toHaveText(formatIQD(num(d.sales_iqd)));
    await expect(page.getByTestId('kpi-net-value')).toHaveText(formatIQD(num(d.net_profit_iqd)));
    await expect(page.getByTestId('kpi-waste-value')).toHaveText(formatIQD(num(d.waste_cost_iqd)));
    await expect(page.getByTestId('kpi-avg-value')).toHaveText(
      d.avg_order_iqd === null ? '—' : formatIQD(num(d.avg_order_iqd)),
    );
    // المقارنة (نفس الساعة) للأعداد، وأمس كاملاً لصافي الربح
    await expect(page.getByTestId('kpi-delivered-delta')).toHaveText(
      countDeltaText(num(d.delivered_count), num(d.delivered_count_prev)),
    );
    await expect(page.getByTestId('kpi-net-delta')).toHaveText(
      `أمس كامل: ${d.net_profit_prev_iqd === null ? '—' : formatIQD(num(d.net_profit_prev_iqd))}`,
    );
    // ترتيب التصميم المعتمد
    const ids = await page
      .getByTestId('kpi-delivered-value')
      .evaluate((el) =>
        [...(el.closest('section')?.children ?? [])].map((c) => c.getAttribute('data-testid')),
      );
    expect(ids).toEqual([
      'kpi-sales',
      'kpi-delivered',
      'kpi-cancelled',
      'kpi-net',
      'kpi-placed',
      'kpi-avg',
      'kpi-waste',
      'kpi-low',
    ]);
    await expect(page.getByTestId('home-subtitle')).toContainText('المقارنة وي أمس لنفس الساعة');
    await expect(page.getByTestId('store-status')).toContainText(/المحل (مفتوح|مسكّر)/);
  });

  test('low stock list shows the database items, in kilos or units, never money', async () => {
    const d = await dashboard(client);
    const items = d.low_stock_items as { name: string; unit: string; qty: number }[];
    await expect(page.getByTestId('low-stock-item')).toHaveCount(items.length);
    for (const it of items) {
      const row = page.getByTestId('low-stock-item').filter({ hasText: it.name }).first();
      await expect(row).toBeVisible();
      if (it.qty === 0) await expect(row).toContainText('نفد');
      else if (it.unit === 'نص كيلو') await expect(row).toContainText('كيلو من حد');
      await expect(row).not.toContainText('د.ع');
    }
  });

  test("today's orders table = the orders created today (Baghdad), newest first", async () => {
    const expected = Math.min(50, await placedTodayFromTable(client));
    await expect(page.getByTestId('orders-table').locator('tbody tr')).toHaveCount(expected);
    const heads = await page.getByTestId('orders-table').locator('thead th').allInnerTexts();
    expect(heads).toEqual(['الطلب', 'الوقت', 'العنوان', 'المجموع', 'الحالة']);
  });

  test('open tiles and "all orders" link go to the orders page', async () => {
    await page.getByTestId('open-pending').click();
    await expect(page).toHaveURL(/\/orders\?tab=pending/);
    await page.goBack();
    await page.getByRole('link', { name: 'كل المخزون' }).click();
    await expect(page).toHaveURL(/\/stock$/);
  });

  test('a large number is shown in full: 1920px screen and a 180px card', async () => {
    await page.route('**/rest/v1/rpc/dashboard_today', async (route) => {
      const res = await route.fetch();
      const json = (await res.json()) as Record<string, unknown>;
      json.sales_iqd = 123_456_750;
      json.net_profit_iqd = 123_456_750;
      await route.fulfill({ response: res, json });
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openHome(page);
    const sales = page.getByTestId('kpi-sales-value');
    await expect(sales).toHaveText('123,456,750 د.ع');
    // الحاوية تتسع للشاشة الكبيرة لكن لا تتجاوز 1600
    const width = await page
      .getByRole('region', { name: 'مؤشرات اليوم' })
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(1300);
    expect(width).toBeLessThanOrEqual(1600);

    await page.addStyleTag({
      content: '[data-testid="kpi-sales"]{width:180px!important;min-width:0!important}',
    });
    const box = await page.getByTestId('kpi-sales').evaluate((card) => {
      const v = card.querySelector('[data-testid="kpi-sales-value"]') as HTMLElement;
      const cs = getComputedStyle(v);
      const c = card.getBoundingClientRect();
      const r = v.getBoundingClientRect();
      return {
        cardWidth: Math.round(c.width),
        fitsInCard: r.left >= c.left - 0.5 && r.right <= c.right + 0.5,
        valueClipped: v.scrollWidth > v.clientWidth,
        cardClipped: (card as HTMLElement).scrollWidth > (card as HTMLElement).clientWidth,
        overflow: cs.overflow,
        textOverflow: cs.textOverflow,
        text: v.textContent,
      };
    });
    expect(box.cardWidth).toBeLessThanOrEqual(181);
    expect(box).toMatchObject({
      fitsInCard: true,
      valueClipped: false,
      cardClipped: false,
      textOverflow: 'clip',
      text: '123,456,750 د.ع',
    });
    expect(box.overflow).toBe('visible');
    await page.unroute('**/rest/v1/rpc/dashboard_today');
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});

test.describe.serial('home (staff)', () => {
  let page: Page;
  let client: SupabaseClient;
  const payloads: Record<string, unknown>[] = [];
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'staff');
    client = await signedInClient(ACCOUNTS.staff);
    page.on('response', async (res) => {
      if (res.url().includes('/rpc/dashboard_today') && res.ok()) {
        // الجسم يضيع إن انتقلت الصفحة أثناء الاستجابة (goto بعد الدخول): نتجاهل تلك الاستجابة
        try {
          payloads.push((await res.json()) as Record<string, unknown>);
        } catch {
          /* navigated away */
        }
      }
    });
  });
  test.afterAll(async () => page.context().close());

  test('cards equal dashboard_today(); no money card and no "د.ع" anywhere', async () => {
    await openHome(page);
    await expectCounts(page, await dashboard(client));
    for (const id of ['sales', 'net', 'avg', 'waste']) {
      await expect(page.getByTestId(`kpi-${id}`)).toHaveCount(0);
    }
    await expect(page.getByTestId('kpi-delivered')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('د.ع');
    const heads = await page.getByTestId('orders-table').locator('thead th').allInnerTexts();
    expect(heads).toEqual(['الطلب', 'الوقت', 'العنوان', 'الحالة']);
    // نفس الطلبات التي يراها الأدمن
    const expected = Math.min(50, await placedTodayFromTable(client));
    await expect(page.getByTestId('orders-table').locator('tbody tr')).toHaveCount(expected);
  });

  test('enforced in the database: the payload the staff browser received has null money', async () => {
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      for (const k of [
        'sales_iqd',
        'sales_prev_iqd',
        'avg_order_iqd',
        'avg_order_prev_iqd',
        'waste_cost_iqd',
        'net_profit_iqd',
        'net_profit_prev_iqd',
      ]) {
        expect(p[k], k).toBeNull();
      }
    }
    const d = await dashboard(client);
    expect(d.sales_iqd).toBeNull();
  });

  test('low stock list: quantities only', async () => {
    const d = await dashboard(client);
    const n = (d.low_stock_items as unknown[]).length;
    await expect(page.getByTestId('low-stock-item')).toHaveCount(n);
  });
});

test.describe.serial('home (writes: live update on a real order)', () => {
  test.skip(!ALLOW_WRITES, 'writes only against a local Supabase (E2E_ALLOW_WRITES=1)');
  let page: Page;
  let client: SupabaseClient;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
    client = await signedInClient(ACCOUNTS.admin);
  });
  test.afterAll(async () => page.context().close());

  test('a new order, then its delivery, update the cards and the table live', async () => {
    await openHome(page);
    const before = await dashboard(client);
    const open0 = before.open as Record<string, number>;

    const order = await placeOrder('طلب اختبار الرئيسية');
    await expect(page.getByTestId('kpi-placed-value')).toHaveText(
      String(num(before.placed_count) + 1),
      {
        timeout: 8_000,
      },
    );
    await expect(page.getByTestId('open-pending-value')).toHaveText(String(num(open0.pending) + 1));
    const row = page
      .getByTestId('orders-table')
      .locator(`tr[data-order-number="${order.order_number}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('[data-status="pending"]')).toBeVisible();

    // تسليم بالمسار الحقيقي بالدوال (أدمن)
    const { data: drivers } = await client.rpc('list_drivers');
    const driver = (drivers as { id: string; is_active: boolean; must_change_pin: boolean }[]).find(
      (x) => x.is_active && !x.must_change_pin,
    );
    expect(driver, 'an assignable demo driver').toBeTruthy();
    const { data: ord } = await client
      .from('orders')
      .select('subtotal_iqd')
      .eq('id', order.id)
      .single();
    const subtotal = num(ord?.subtotal_iqd);
    for (const step of ['preparing', 'assign', 'ready', 'out_for_delivery', 'delivered']) {
      const { error } =
        step === 'assign'
          ? await client.rpc('assign_driver', {
              p_order_id: order.id,
              p_driver_id: driver?.id ?? '',
            })
          : await client.rpc('set_order_status', { p_order_id: order.id, p_status: step });
      expect(error, step).toBeNull();
    }

    await expect(row.locator('[data-status="delivered"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('kpi-delivered-value')).toHaveText(
      String(num(before.delivered_count) + 1),
    );
    await expect(page.getByTestId('open-pending-value')).toHaveText(String(open0.pending));
    await expect(page.getByTestId('kpi-sales-value')).toHaveText(
      formatIQD(num(before.sales_iqd) + subtotal),
    );
    // وما تعرضه الصفحة = ما تحسبه القاعدة الآن
    const after = await dashboard(client);
    await expectCounts(page, after);
    await expect(page.getByTestId('kpi-net-value')).toHaveText(
      formatIQD(num(after.net_profit_iqd)),
    );
  });
});

test.describe.serial('home: stuck-notifications badge (admin only)', () => {
  test('hidden at 0, shown with the count and linked to the settings indicator otherwise', async ({
    browser,
  }) => {
    const page = await pageAs(browser, 'admin');
    const client = await signedInClient(ACCOUNTS.admin);
    const real = await dashboard(client);
    const mock = (n: number | null) =>
      page.route('**/rest/v1/rpc/dashboard_today', async (route) => {
        const res = await route.fetch();
        const json = (await res.json()) as Record<string, unknown>;
        json.stuck_notifications = n;
        await route.fulfill({ response: res, json });
      });

    // القيمة الحقيقية: الشارة موجودة فقط إن كان العدد > 0
    await openHome(page);
    await expect(page.getByTestId('stuck-badge')).toHaveCount(
      num(real.stuck_notifications) > 0 ? 1 : 0,
    );

    await mock(0);
    await openHome(page);
    await expect(page.getByTestId('stuck-badge')).toHaveCount(0);
    await page.unroute('**/rest/v1/rpc/dashboard_today');

    await mock(4);
    await openHome(page);
    const badge = page.getByTestId('stuck-badge');
    await expect(badge).toContainText('4 إشعار عالق');
    await expect(badge).toHaveAttribute('href', '/settings#notifications');
    await badge.click();
    await expect(page).toHaveURL(/\/settings#notifications$/);
    await expect(page.getByTestId('stuck-notifications')).toBeVisible();
    await page.context().close();
  });

  test('staff never get the badge, and their payload has null', async ({ browser }) => {
    const page = await pageAs(browser, 'staff');
    await openHome(page);
    await expect(page.getByTestId('stuck-badge')).toHaveCount(0);
    const d = await dashboard(await signedInClient(ACCOUNTS.staff));
    expect(d.stuck_notifications).toBeNull();
    await page.context().close();
  });
});
