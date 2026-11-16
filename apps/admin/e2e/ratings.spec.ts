import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNTS } from './accounts';
import { pageAs } from './helpers';
import { ALLOW_WRITES, deliverOrder, placeOrder, signedInClient } from './supabase';

// T26: التقييمات. الشاشة = ratings_summary / ratings_list (قاعدة البيانات تحسب، الصفحة تعرض) للأدمن والموظف،
// الفلترة تغيّر الرأس والقائمة معاً، والتقييم الجديد من الزبون يظهر. تدفق الزبون يُجرى بعميل Supabase
// بحساب الزبون (تطبيق الموبايل Expo خارج Playwright؛ الواجهة نفسها تستدعي rate_order). الكتابة فقط
// مع E2E_ALLOW_WRITES=1 (CI، Supabase محلي).

interface Summary {
  count: number;
  avg: number | null;
  distribution: Record<string, number>;
}

async function summary(
  client: SupabaseClient,
  args: Record<string, unknown> = {},
): Promise<Summary> {
  const { data, error } = await client.rpc('ratings_summary', args);
  if (error) throw error;
  return data as Summary;
}

async function expectHeader(page: Page, s: Summary) {
  await expect(page.getByTestId('rating-count')).toHaveText(String(s.count));
  await expect(page.getByTestId('rating-avg')).toHaveText(s.avg === null ? '—' : s.avg.toFixed(1));
  for (const n of [1, 2, 3, 4, 5]) {
    await expect(page.getByTestId(`dist-${n}-count`)).toHaveText(String(s.distribution[String(n)]));
  }
}

function articles(page: Page) {
  return page.getByTestId('ratings-list').locator('article');
}

function baghdadDay(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

test.describe.serial('ratings (admin)', () => {
  let page: Page;
  let client: SupabaseClient;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
    client = await signedInClient(ACCOUNTS.admin);
  });
  test.afterAll(async () => page.context().close());

  test('header (average, count, distribution) equals ratings_summary; the list is the database list', async () => {
    await page.goto('/ratings');
    await expect(page.getByRole('heading', { level: 1, name: 'التقييمات' })).toBeVisible();
    const s = await summary(client);
    await expectHeader(page, s);
    await expect(articles(page)).toHaveCount(Math.min(50, s.count));
    // الأحدث أولاً
    const { data } = await client.rpc('ratings_list', { p_limit: 3 });
    const rows = (data ?? []) as { order_number: number }[];
    for (const [i, r] of rows.entries()) {
      await expect(articles(page).nth(i)).toHaveAttribute(
        'data-order-number',
        String(r.order_number),
      );
    }
  });

  test('filter 1-2 stars changes the header and the list together', async () => {
    await page.getByRole('button', { name: 'نجمة ونجمتان' }).click();
    await expect(page).toHaveURL(/f=low2/);
    const s = await summary(client, { p_min_stars: 1, p_max_stars: 2 });
    await expectHeader(page, s);
    await expect(articles(page)).toHaveCount(Math.min(50, s.count));
    const stars = await articles(page).evaluateAll((els) =>
      els.map((e) => Number(e.getAttribute('data-stars'))),
    );
    expect(stars.every((n) => n <= 2)).toBe(true);
    expect(s.distribution['5']).toBe(0);

    await page.getByRole('button', { name: '5 نجوم' }).click();
    const s5 = await summary(client, { p_min_stars: 5, p_max_stars: 5 });
    await expectHeader(page, s5);
    await expect(articles(page)).toHaveCount(Math.min(50, s5.count));
  });

  test('"with comment" and the date range apply to both parts', async () => {
    await page.getByRole('button', { name: 'بيها تعليق' }).click();
    const sc = await summary(client, { p_with_comment: true });
    await expectHeader(page, sc);
    await expect(articles(page)).toHaveCount(Math.min(50, sc.count));
    await expect(articles(page).locator('p')).toHaveCount(Math.min(50, sc.count));

    await page.getByRole('button', { name: 'الكل', exact: true }).click();
    const today = baghdadDay();
    await page.getByLabel('من', { exact: true }).fill(today);
    await page.getByLabel('إلى', { exact: true }).fill(today);
    const sd = await summary(client, { p_from: today, p_to: today });
    await expectHeader(page, sd);
    await expect(articles(page)).toHaveCount(Math.min(50, sd.count));

    // مدى معكوس: رسالة بدل استعلام
    await page.getByLabel('من', { exact: true }).fill('2999-01-02');
    await page.getByLabel('إلى', { exact: true }).fill('2999-01-01');
    await expect(page.getByRole('alert').filter({ hasText: 'المدى غير صحيح' })).toBeVisible();
  });

  test('rapid clicks keep every filter in the URL (M2)', async () => {
    await page.goto('/ratings');
    await expect(page.getByTestId('rating-count')).not.toHaveText('…');
    await page.getByRole('button', { name: '4', exact: true }).click();
    await page.getByLabel('من').fill('2026-01-01');
    await page.getByLabel('إلى').fill('2026-12-31');
    await expect
      .poll(() => {
        const sp = new URL(page.url()).searchParams;
        return [sp.get('f'), sp.get('from'), sp.get('to')].join('|');
      })
      .toBe('4|2026-01-01|2026-12-31');
  });

  test('the order link opens that order', async () => {
    await page.goto('/ratings');
    await expect(page.getByTestId('rating-count')).not.toHaveText('…');
    await expect(page.getByText('جارٍ التحميل…')).toHaveCount(0);
    const first = articles(page).first();
    test.skip((await articles(page).count()) === 0, 'no ratings in this database');
    const n = await first.getAttribute('data-order-number');
    await first.getByRole('link', { name: `الطلب #${n}` }).click();
    await expect(page).toHaveURL(/\/orders\?order=/);
    await expect(page.getByTestId('order-detail')).toBeVisible();
  });
});

test.describe.serial('ratings (staff)', () => {
  test('staff open the page and see the same figures', async ({ browser }) => {
    const page = await pageAs(browser, 'staff');
    const client = await signedInClient(ACCOUNTS.staff);
    await page.goto('/ratings');
    await expect(page.getByRole('heading', { level: 1, name: 'التقييمات' })).toBeVisible();
    await expectHeader(page, await summary(client));
    await page.context().close();
  });

  test('customer and driver are refused by the database', async () => {
    for (const phone of [ACCOUNTS.customer, ACCOUNTS.driver]) {
      const c = await signedInClient(phone);
      const { error } = await c.rpc('ratings_summary');
      expect(error?.message, phone).toBe('NOT_ALLOWED');
      const l = await c.rpc('ratings_list');
      expect(l.error?.message, phone).toBe('NOT_ALLOWED');
    }
  });
});

test.describe.serial('customer rating flow (writes)', () => {
  test.skip(!ALLOW_WRITES, 'writes only against a local Supabase (E2E_ALLOW_WRITES=1)');
  let admin: SupabaseClient;
  test.beforeAll(async () => {
    admin = await signedInClient(ACCOUNTS.admin);
  });

  test('rules: delivered only, once, 1..5, trimmed plain text with a limit; then the admin sees it', async ({
    browser,
  }) => {
    const order = await placeOrder('طلب اختبار التقييم');
    const customer = await signedInClient(order.customerPhone);

    // قبل التسليم: لا تقييم
    let r = await customer.rpc('rate_order', { p_order_id: order.id, p_stars: 5 });
    expect(r.error?.message).toBe('ORDER_NOT_RATEABLE');

    await deliverOrder(admin, order.id);

    // مدى النجوم والتعليق الطويل
    expect(
      (await customer.rpc('rate_order', { p_order_id: order.id, p_stars: 0 })).error?.message,
    ).toBe('INVALID_STARS');
    expect(
      (await customer.rpc('rate_order', { p_order_id: order.id, p_stars: 6 })).error?.message,
    ).toBe('INVALID_STARS');
    expect(
      (
        await customer.rpc('rate_order', {
          p_order_id: order.id,
          p_stars: 4,
          p_comment: 'x'.repeat(501),
        })
      ).error?.message,
    ).toBe('COMMENT_TOO_LONG');

    const before = await summary(admin);
    const comment = '<b>ممتاز</b> & طازج';
    r = await customer.rpc('rate_order', {
      p_order_id: order.id,
      p_stars: 5,
      p_comment: `  \n${comment}\t `,
    });
    expect(r.error).toBeNull();
    // مرة واحدة
    r = await customer.rpc('rate_order', {
      p_order_id: order.id,
      p_stars: 1,
      p_comment: 'غيّرت رأيي',
    });
    expect(r.error?.message).toBe('ALREADY_RATED');
    // زبون آخر لا يقيّم طلب غيره
    const other = await signedInClient(
      order.customerPhone === '07000000102' ? '07000000103' : '07000000102',
    );
    expect(
      (await other.rpc('rate_order', { p_order_id: order.id, p_stars: 1 })).error?.message,
    ).toBe('ORDER_NOT_RATEABLE');

    const after = await summary(admin);
    expect(after.count).toBe(before.count + 1);
    expect(after.distribution['5']).toBe((before.distribution['5'] ?? 0) + 1);

    // الأدمن والموظف يريان التقييم، والتعليق نص صرف (لا عنصر b)
    for (const role of ['admin', 'staff'] as const) {
      const page = await pageAs(browser, role);
      await page.goto('/ratings');
      const card = articles(page).filter({
        has: page.getByRole('link', { name: `الطلب #${order.order_number}` }),
      });
      await expect(card).toHaveCount(1);
      await expect(card.locator('p')).toHaveText(comment);
      await expect(card.locator('b')).toHaveCount(0);
      await expect(card).toHaveAttribute('data-stars', '5');
      await expectHeader(page, after);
      await page.context().close();
    }
  });
});
