import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { ACCOUNTS } from './accounts';
import { pageAs } from './helpers';
import { ALLOW_WRITES, signedInClient } from './supabase';

// T20: التقارير والأرباح. القراءة على أي بيانات seed: البطاقات = report_summary لنفس المدى (قاعدة البيانات
// تحسب، الصفحة تعرض)، تغيير المدى يحدّثها، والتصدير ينزل ملفاً. الكتابة (هدر 7 أنصاف كيلو و3 باقات)
// فقط مع E2E_ALLOW_WRITES=1 (CI، Supabase محلي).

/** نفس formatIQD (packages/shared): "12,500 د.ع". الحزمة CommonJS فلا تُستورد بـ Playwright ESM. */
function formatIQD(n: number): string {
  return `${n < 0 ? '-' : ''}${Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')} د.ع`;
}

/** يوم بغداد (UTC+3 بلا توقيت صيفي). */
function baghdadDay(offsetDays = 0): string {
  return new Date(Date.now() + 3 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function summary(admin: SupabaseClient, from: string, to: string) {
  const { data, error } = await admin.rpc('report_summary', { p_from: from, p_to: to });
  if (error) throw error;
  return data as Record<string, number | null>;
}

async function expectCards(page: Page, s: Record<string, number | null>) {
  await expect(page.getByTestId('kpi-delivered-value')).toHaveText(String(s.delivered_count));
  await expect(page.getByTestId('kpi-placed-value')).toHaveText(String(s.placed_count));
  await expect(page.getByTestId('kpi-sales-value')).toHaveText(formatIQD(Number(s.sales_iqd)));
  await expect(page.getByTestId('kpi-net-value')).toHaveText(formatIQD(Number(s.net_profit_iqd)));
  await expect(page.getByTestId('kpi-waste-value')).toHaveText(formatIQD(Number(s.waste_cost_iqd)));
}

test.describe.serial('reports (admin)', () => {
  let page: Page;
  let admin: SupabaseClient;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
    admin = await signedInClient(ACCOUNTS.admin);
  });
  test.afterAll(async () => page.context().close());

  test('opens on the last 7 days; cards equal report_summary', async () => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { level: 1, name: 'التقارير والأرباح' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'آخر 7 أيام' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const from = baghdadDay(-6);
    const to = baghdadDay();
    await expect(page.getByTestId('report-range')).toContainText(`${from} ← ${to}`);
    await expectCards(page, await summary(admin, from, to));
    await expect(page.getByTestId('daily-chart')).toBeVisible();
  });

  test('changing the range updates the cards', async () => {
    await page.getByRole('button', { name: 'اليوم', exact: true }).click();
    await expect(page.getByTestId('report-range')).toContainText(baghdadDay());
    await expectCards(page, await summary(admin, baghdadDay(), baghdadDay()));

    await page.getByRole('button', { name: 'هذا الشهر' }).click();
    const monthStart = `${baghdadDay().slice(0, 8)}01`;
    await expect(page.getByTestId('report-range')).toContainText(monthStart);
    await expectCards(page, await summary(admin, monthStart, baghdadDay()));

    // مخصص: أكثر من 366 يوماً يُرفض بالواجهة
    await page.getByRole('button', { name: 'مخصص' }).click();
    await page.getByLabel('من', { exact: true }).fill('2020-01-01');
    await page.getByLabel('إلى', { exact: true }).fill('2021-01-05');
    await expect(page.getByRole('alert').filter({ hasText: '366' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'عرض' })).toBeDisabled();
    await page.getByLabel('إلى', { exact: true }).fill('2020-12-31');
    await page.getByRole('button', { name: 'عرض' }).click();
    await expect(page.getByTestId('report-range')).toContainText('2020-01-01 ← 2020-12-31');
    await expectCards(page, await summary(admin, '2020-01-01', '2020-12-31'));
  });

  test('CSV export downloads the daily indicators with the database total', async () => {
    await page.getByRole('button', { name: 'آخر 7 أيام' }).click();
    const s = await summary(admin, baghdadDay(-6), baghdadDay());
    await expectCards(page, s);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'تصدير CSV', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `mukhdar-report-${baghdadDay(-6)}_${baghdadDay()}.csv`,
    );
    const path = await download.path();
    const text = (await readFile(path, 'utf8')).replace(String.fromCharCode(0xfeff), '');
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toContain('المبيعات (بدون التوصيل)');
    expect(lines).toHaveLength(1 + 7 + 1);
    expect(lines.at(-1)).toBe(
      [
        'المجموع',
        s.placed_count,
        s.delivered_count,
        s.cancelled_count,
        s.sales_iqd,
        s.delivery_fees_iqd,
        s.cost_iqd,
        s.gross_profit_iqd,
        s.waste_cost_iqd,
        s.adjust_loss_iqd,
        s.net_profit_iqd,
      ].join(','),
    );
  });

  test('waste of 7 half-kilos shows "3.5 كيلو", 3 bunches "3 باقة" (screen and CSV)', async () => {
    test.skip(!ALLOW_WRITES, 'writes only against local Supabase (E2E_ALLOW_WRITES=1)');
    const { data: cat, error: catErr } = await admin
      .from('categories')
      .select('id')
      .limit(1)
      .single();
    if (catErr) throw catErr;
    const tag = Date.now().toString(36);
    const make = async (name: string, unit: string, price: number) => {
      const { data: id, error } = await admin.rpc('admin_save_product', {
        p: { name, unit, price_iqd: price, category_id: cat.id, cost_iqd: 250 },
      });
      if (error) throw error;
      const { error: e2 } = await admin.rpc('adjust_stock', {
        p_product_id: id,
        p_qty: 20,
        p_type: 'purchase',
        p_unit_cost_iqd: 250,
      });
      if (e2) throw e2;
      return id as string;
    };
    const kilo = await make(`طماطة تقرير ${tag}`, 'نص كيلو', 750);
    const bunch = await make(`كرفس تقرير ${tag}`, 'باقة', 500);
    const { error } = await admin.rpc('adjust_stock_bulk', {
      p_items: [
        { product_id: kilo, qty: -7 },
        { product_id: bunch, qty: -3 },
      ],
      p_type: 'waste',
      p_note: 'e2e T20',
    });
    if (error) throw error;

    await page.getByRole('button', { name: 'اليوم', exact: true }).click();
    const table = page.getByTestId('waste-report');
    await expect(
      table.locator(`tr[data-product="طماطة تقرير ${tag}"]`).getByTestId('waste-qty'),
    ).toHaveText('3.5 كيلو');
    await expect(
      table.locator(`tr[data-product="كرفس تقرير ${tag}"]`).getByTestId('waste-qty'),
    ).toHaveText('3 باقة');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'تصدير الهدر CSV' }).click(),
    ]);
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv).toContain(`طماطة تقرير ${tag},كيلو,3.5,1750,0,0,1750`);
    expect(csv).toContain(`كرفس تقرير ${tag},باقة,3,750,0,0,750`);

    // تنظيف: تعطيل (لا حذف: المنتج له تاريخ، L4(a))
    for (const id of [kilo, bunch]) {
      await admin.rpc('admin_save_product', { p: { id, is_active: false } });
    }
  });
});

test('staff cannot call the report RPCs (database, not only the page)', async () => {
  const staff = await signedInClient(ACCOUNTS.staff);
  const { error } = await staff.rpc('report_summary', { p_from: baghdadDay(), p_to: baghdadDay() });
  expect(error?.message).toBe('NOT_ALLOWED');
  const { error: e2 } = await staff.rpc('report_waste', {
    p_from: baghdadDay(),
    p_to: baghdadDay(),
  });
  expect(e2?.message).toBe('NOT_ALLOWED');
});
