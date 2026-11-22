import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNTS } from './accounts';
import { expectNotAuthorized, pageAs } from './helpers';
import { ALLOW_WRITES, deliverOrder, placeOrder, signedInClient } from './supabase';

// T41: تسليم الكاش (SPEC-cash §4، SPEC-admin §2.11). القراءة (الصفحة، الإخفاء عن الموظف) على أي بيانات seed؛
// الكتابة (توصيل طلبات بالمسار الحقيقي ثم تسجيل التسليم والتصحيح والتقرير وإعداد الأجرة) فقط مع
// E2E_ALLOW_WRITES=1 (CI، Supabase محلي). الأرقام تُقرأ من دوال قاعدة البيانات نفسها، لا تُحسب هنا.

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

interface Outstanding {
  driver_id: string;
  full_name: string;
  outstanding_iqd: number;
  order_count: number;
  includes_delivery_fee: boolean;
}

async function outstandingFor(
  client: SupabaseClient,
  driverId: string,
): Promise<Outstanding | undefined> {
  const { data, error } = await client.rpc('cash_outstanding');
  if (error) throw error;
  return (data as Outstanding[]).find((r) => r.driver_id === driverId);
}

/** يوصّل طلباً جديداً بالمسار الحقيقي ويرجع سائقه (deliverOrder يختار أول سائق قابل للتعيين دائماً). */
async function deliverOne(admin: SupabaseClient): Promise<{ driverId: string; name: string }> {
  const order = await placeOrder('طلب اختبار تسليم الكاش');
  await deliverOrder(admin, order.id);
  const { data: o, error } = await admin
    .from('orders')
    .select('driver_id')
    .eq('id', order.id)
    .single();
  if (error) throw error;
  const driverId = (o as { driver_id: string }).driver_id;
  const { data: p, error: pe } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', driverId)
    .single();
  if (pe) throw pe;
  return { driverId, name: (p as { full_name: string }).full_name };
}

const balances = (page: Page) => page.getByTestId('cash-balances');
const driverRow = (page: Page, name: string) =>
  balances(page).locator(`[data-driver-name="${name}"]`);

async function openCash(page: Page) {
  await page.goto('/cash');
  await expect(page.getByRole('heading', { level: 1, name: 'تسليم الكاش' })).toBeVisible();
}

async function openHistory(page: Page) {
  await page.getByRole('tab', { name: 'السجل' }).click();
  await expect(page.getByTestId('cash-history')).toBeVisible();
}

test.describe.serial('cash handover (staff, then admin)', () => {
  let staff: Page;
  let adminPage: Page;
  let admin: SupabaseClient;
  let driverId = '';
  let driverName = '';

  test.beforeAll(async ({ browser }) => {
    staff = await pageAs(browser, 'staff');
    adminPage = await pageAs(browser, 'admin');
    admin = await signedInClient(ACCOUNTS.admin);
  });
  test.afterAll(async () => {
    // لا نترك الإعداد مقلوباً حتى لو فشل اختبار بالمنتصف
    if (ALLOW_WRITES) {
      await admin.rpc('update_app_settings', { p: { cash_handover_includes_delivery_fee: true } });
    }
    await staff.context().close();
    await adminPage.context().close();
  });

  test('staff opens /cash: held-now header, balances tab, history limited to 7 days, no correction', async () => {
    await openCash(staff);
    await expect(staff.getByRole('tab', { name: 'الأرصدة' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(staff.getByTestId('cash-held-now')).toContainText('الكاش عند السواق الآن');
    await openHistory(staff);
    await expect(staff.getByTestId('staff-history-note')).toHaveText(
      'يظهر لك سجل آخر 7 أيام فقط. الأقدم عند المدير.',
    );
    await expect(staff.getByTestId('correct-handover')).toHaveCount(0);
  });

  test('staff cannot reach reports or settings (so no cash report section, no fee setting)', async () => {
    for (const path of ['/reports', '/settings']) {
      const res = await staff.goto(path);
      expect(res?.status(), path).toBe(403);
      await expectNotAuthorized(staff);
    }
    const staffClient = await signedInClient(ACCOUNTS.staff);
    const { error } = await staffClient.rpc('report_cash', {
      p_from: baghdadDay(-6),
      p_to: baghdadDay(),
    });
    expect(error?.message).toBe('NOT_ALLOWED');
  });

  test.describe.serial('writes', () => {
    test.skip(!ALLOW_WRITES, 'writes only against a local Supabase (E2E_ALLOW_WRITES=1)');

    test('staff records a matching handover: balance goes to 0', async () => {
      ({ driverId, name: driverName } = await deliverOne(admin));
      const before = await outstandingFor(admin, driverId);
      expect(before?.outstanding_iqd).toBeGreaterThan(0);

      await openCash(staff);
      const row = driverRow(staff, driverName);
      await expect(row).toHaveAttribute('data-outstanding', String(before?.outstanding_iqd));
      await row.getByTestId('receive-cash').click();

      const dialog = staff.getByTestId('handover-dialog');
      await expect(dialog.getByTestId('handover-expected')).toHaveText(
        formatIQD(before?.outstanding_iqd ?? 0),
      );
      await expect(dialog.getByTestId('handover-basis')).toHaveText('شامل أجرة التوصيل');
      // الحقل فارغ ولا يُملأ تلقائياً، والزر معطّل حتى يُكتب المبلغ
      await expect(dialog.locator('#handover-received')).toHaveValue('');
      await expect(dialog.getByTestId('handover-confirm')).toBeDisabled();
      await dialog.getByTestId('handover-same').click();
      await expect(dialog.getByTestId('handover-diff')).toContainText('مطابق');
      await expect(dialog.getByLabel(/ملاحظة/)).toHaveCount(0);
      await dialog.getByTestId('handover-confirm').click();

      await expect(staff.getByTestId('cash-notice')).toContainText('تم: استلمت');
      await expect(driverRow(staff, driverName)).toHaveAttribute('data-outstanding', '0');
      await expect(driverRow(staff, driverName).getByTestId('receive-cash')).toBeDisabled();
      expect((await outstandingFor(admin, driverId))?.outstanding_iqd ?? 0).toBe(0);
    });

    test('a shortage needs a note: button disabled without it; with it the history shows a "نقص" badge', async () => {
      const again = await deliverOne(admin);
      expect(again.driverId).toBe(driverId); // deliverOrder يختار نفس السائق دائماً
      const before = await outstandingFor(admin, driverId);
      const expected = before?.outstanding_iqd ?? 0;
      expect(expected).toBeGreaterThanOrEqual(250);

      await openCash(staff);
      await driverRow(staff, driverName).getByTestId('receive-cash').click();
      const dialog = staff.getByTestId('handover-dialog');
      await dialog.locator('#handover-received').fill(String(expected - 250));
      await expect(dialog.getByTestId('handover-diff')).toContainText('نقص 250 د.ع');
      await expect(dialog.getByTestId('handover-confirm')).toBeDisabled();
      await dialog.getByLabel(/ملاحظة/).fill('ورقة ممزقة');
      await expect(dialog.getByTestId('handover-confirm')).toBeEnabled();
      await dialog.getByTestId('handover-confirm').click();
      await expect(staff.getByTestId('cash-notice')).toContainText('تم: استلمت');

      await openHistory(staff);
      const line = staff
        .getByTestId('history-table')
        .locator('tr', { hasText: 'ورقة ممزقة' })
        .first();
      await expect(line).toBeVisible();
      await expect(line.getByTestId('history-diff')).toHaveAttribute('data-diff', 'shortage');
      await expect(line.getByTestId('history-diff')).toHaveText('نقص 250 د.ع');
      await expect(line.getByTestId('correct-handover')).toHaveCount(0);
    });

    test('a delivery landing while the dialog is open: CASH_BALANCE_CHANGED refreshes the amount and clears the typed value', async () => {
      await deliverOne(admin);
      await openCash(staff);
      await driverRow(staff, driverName).getByTestId('receive-cash').click();
      const dialog = staff.getByTestId('handover-dialog');
      await dialog.getByTestId('handover-same').click(); // مبلغ مكتوب مطابق لما عُرض

      await deliverOne(admin); // يصل توصيل جديد بعد العرض
      const now = await outstandingFor(admin, driverId);
      // نضغط فوراً؛ إن سبقنا الاستطلاع فالنافذة تكون تحدّثت وتعطّل الزر (النتيجة نفسها)
      await dialog
        .getByTestId('handover-confirm')
        .click({ timeout: 3000 })
        .catch(() => undefined);

      await expect(dialog.getByTestId('handover-expected')).toHaveText(
        formatIQD(now?.outstanding_iqd ?? 0),
      );
      await expect(dialog.locator('#handover-received')).toHaveValue('');
      await expect(dialog.getByText(/عدّ من جديد/).first()).toBeVisible();
      await expect(dialog.getByTestId('handover-diff')).toHaveCount(0); // لا نقص وهمي

      // العدّ من جديد ينجح (مفتاح منع التكرار جديد)
      await dialog.getByTestId('handover-same').click();
      await dialog.getByTestId('handover-confirm').click();
      await expect(staff.getByTestId('cash-notice')).toContainText('تم: استلمت');
      expect((await outstandingFor(admin, driverId))?.outstanding_iqd ?? 0).toBe(0);
    });

    test('R4 M2/T8: a lost response, then a changed amount: the dialog shows the stored amount and warns', async () => {
      await deliverOne(admin);
      const expected = (await outstandingFor(admin, driverId))?.outstanding_iqd ?? 0;
      expect(expected).toBeGreaterThanOrEqual(250);
      await openCash(staff);
      await driverRow(staff, driverName).getByTestId('receive-cash').click();
      const dialog = staff.getByTestId('handover-dialog');
      await expect(dialog.getByTestId('handover-expected')).toHaveText(formatIQD(expected));

      // the balance poll waits until the end, so the dialog stays on the form between the two attempts
      let release = () => {};
      const gate = new Promise<void>((r) => (release = r));
      const pollUrl = '**/rest/v1/rpc/cash_outstanding';
      await staff.route(pollUrl, async (route) => {
        await gate;
        await route.continue();
      });
      // the first record call reaches the server (and commits), then its response is lost
      const recordUrl = '**/rest/v1/rpc/record_cash_handover';
      let lost = false;
      await staff.route(recordUrl, async (route) => {
        if (lost) return route.continue();
        lost = true;
        await route.fetch();
        await route.abort('failed');
      });

      await dialog.getByTestId('handover-same').click();
      await dialog.getByTestId('handover-confirm').click();
      await expect(dialog.getByTestId('handover-error')).toContainText('حاول مرة ثانية');
      expect((await outstandingFor(admin, driverId))?.outstanding_iqd ?? 0).toBe(0); // it was recorded

      // they recount, type 250 less with a note, and confirm again
      await dialog.locator('#handover-received').fill(String(expected - 250));
      await dialog.getByLabel(/ملاحظة/).fill('عدّيت مرة ثانية');
      await dialog.getByTestId('handover-confirm').click();

      await expect(dialog.getByTestId('handover-recorded')).toContainText(
        'انسجل الاستلام قبل شوية',
      );
      await expect(dialog.getByTestId('handover-recorded-amount')).toHaveText(formatIQD(expected));
      await expect(dialog.getByTestId('handover-recorded-note')).toHaveText('بلا ملاحظة');
      const warning = dialog.getByTestId('handover-recorded-warning');
      await expect(warning).toContainText(formatIQD(expected));
      await expect(warning).toContainText(formatIQD(expected - 250));

      release();
      await staff.unroute(pollUrl);
      await staff.unroute(recordUrl);
      await dialog.getByTestId('handover-recorded-ok').click();
      await expect(dialog).toHaveCount(0);
    });

    test('admin corrects a handover (note required), the row shows "مُصحَّح" with the original amount', async () => {
      await openCash(adminPage);
      await openHistory(adminPage);
      const line = adminPage
        .getByTestId('history-table')
        .locator('tr', { hasText: 'ورقة ممزقة' })
        .first();
      const handoverId = await line.getAttribute('data-handover-id');
      expect(handoverId).toBeTruthy();
      await line.getByTestId('correct-handover').click();
      const dialog = adminPage.getByTestId('correct-dialog');
      await expect(dialog.getByTestId('correct-confirm')).toBeDisabled(); // لم يتغير المبلغ ولا ملاحظة
      const current = Number(
        (await dialog.locator('#correct-received').inputValue()).replace(/\D/g, ''),
      );
      await dialog.locator('#correct-received').fill(String(current + 250));
      await expect(dialog.getByTestId('correct-confirm')).toBeDisabled(); // الملاحظة إلزامية
      await dialog.getByLabel(/ملاحظة/).fill('عدّ ثاني: ظهرت ورقة');
      await dialog.getByTestId('correct-confirm').click();
      await expect(adminPage.getByTestId('cash-notice')).toHaveText('تم تصحيح التسليم');
      // التصحيح يستبدل الملاحظة، فنجد الصف بمعرّف التسليم لا بنص الملاحظة القديم
      const after = adminPage.locator(`tr[data-handover-id="${handoverId}"]`);
      await expect(after.getByTestId('history-corrected')).toContainText('مُصحَّح');
      await expect(after.getByTestId('history-corrected')).toContainText(formatIQD(current));
      await expect(after).toContainText('عدّ ثاني: ظهرت ورقة');
    });

    test('admin report: "الكاش والسواق" shows report_cash numbers and the driver row', async () => {
      const from = baghdadDay(-6);
      const to = baghdadDay();
      const { data, error } = await admin.rpc('report_cash', { p_from: from, p_to: to });
      if (error) throw error;
      const r = data as {
        held_now_iqd: number;
        totals: { shortage_iqd: number; overage_iqd: number; fees_kept_iqd: number };
      };
      await adminPage.goto('/reports');
      const section = adminPage.getByTestId('cash-report');
      await expect(section).toBeVisible();
      await expect(section.getByTestId('cash-kpi-held-value')).toHaveText(
        formatIQD(r.held_now_iqd),
      );
      await expect(section.getByTestId('cash-kpi-shortage-value')).toHaveText(
        formatIQD(r.totals.shortage_iqd),
      );
      await expect(section.getByTestId('cash-kpi-overage-value')).toHaveText(
        formatIQD(r.totals.overage_iqd),
      );
      // R4 M1: delivery fees kept by drivers
      await expect(section.getByTestId('cash-kpi-fees-kept-value')).toHaveText(
        formatIQD(r.totals.fees_kept_iqd),
      );
      await expect(
        section.getByTestId('cash-report-table').locator(`[data-driver-name="${driverName}"]`),
      ).toBeVisible();
    });

    test('admin fee setting: shows the explanation and warning; "stays with the driver" changes the dialog and the balance', async () => {
      await adminPage.goto('/settings');
      const card = adminPage.getByTestId('fee-setting');
      await expect(card.getByRole('heading', { name: 'أجرة التوصيل وتسليم الكاش' })).toBeVisible();
      await expect(card.getByTestId('fee-warning')).toHaveText(
        'التغيير يسري على الكاش اللي بيد السواق الآن والتسليمات الجاية فقط. التسليمات المسجّلة قبل التغيير ما تتغير.',
      );
      await expect(card.getByRole('radio', { name: /أجرة التوصيل للمحل/ })).toBeChecked();

      await deliverOne(admin);
      const before = await outstandingFor(admin, driverId);
      expect(before?.includes_delivery_fee).toBe(true);

      // R4 M1: drivers hold delivery fees, so saving asks for a confirmation with the total from the database
      const impact = async () => {
        const { data, error } = await admin.rpc('cash_fee_setting_impact');
        if (error) throw error;
        return (data as { fees_iqd: number }[])[0]?.fees_iqd ?? 0;
      };
      const fees = await impact();
      expect(fees).toBeGreaterThan(0);
      await card.getByRole('radio', { name: /أجرة التوصيل تبقى عند السائق/ }).check();
      await card.getByTestId('fee-save').click();
      const confirm = card.getByTestId('fee-confirm');
      await expect(confirm).toContainText(formatIQD(fees));
      await expect(confirm).toContainText('ما تنطلب منهم');
      await confirm.getByTestId('fee-confirm-no').click(); // back: nothing saved
      await expect(confirm).toHaveCount(0);
      expect((await outstandingFor(admin, driverId))?.includes_delivery_fee).toBe(true);
      await card.getByTestId('fee-save').click();
      await card.getByTestId('fee-confirm-yes').click();
      await expect(card.getByTestId('fee-saved')).toBeVisible();

      const after = await outstandingFor(admin, driverId);
      expect(after?.includes_delivery_fee).toBe(false);
      expect(after?.outstanding_iqd).toBeLessThan(before?.outstanding_iqd ?? 0);

      await openCash(staff);
      await expect(driverRow(staff, driverName)).toHaveAttribute(
        'data-outstanding',
        String(after?.outstanding_iqd),
      );
      await driverRow(staff, driverName).getByTestId('receive-cash').click();
      const dialog = staff.getByTestId('handover-dialog');
      await expect(dialog.getByTestId('handover-basis')).toHaveText(
        'بدون أجرة التوصيل (تبقى عند السائق)',
      );
      await expect(dialog.getByTestId('handover-expected')).toHaveText(
        formatIQD(after?.outstanding_iqd ?? 0),
      );
      await staff.keyboard.press('Escape');

      // نعيد الإعداد من الواجهة نفسها
      await adminPage.goto('/settings');
      const again = adminPage.getByTestId('fee-setting');
      await again.getByRole('radio', { name: /أجرة التوصيل للمحل/ }).check();
      await again.getByTestId('fee-save').click();
      await expect(again.getByTestId('fee-confirm')).toContainText('تنضاف');
      await again.getByTestId('fee-confirm-yes').click();
      await expect(again.getByTestId('fee-saved')).toBeVisible();
      expect((await outstandingFor(admin, driverId))?.includes_delivery_fee).toBe(true);
    });
  });
});
