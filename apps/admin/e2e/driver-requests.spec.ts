import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNTS } from './accounts';
import { expectNotAuthorized, pageAs, sidebarLinks } from './helpers';
import {
  ALLOW_WRITES,
  seedDriverRequest,
  signedInClient,
  type SeededDriverRequest,
} from './supabase';

// T29: "طلبات السواق" (SPEC-admin §2.10). أدمن فقط؛ الموافقة مستحيلة بلا خانة "اتصلت وتأكدت"؛ قرار واحد لكل
// طلب مع تدقيق؛ الشارة = عدد المعلّق. الطلبات تُزرع بالمسار الحقيقي (Edge Function driver-register)؛ والكتابة
// فقط مع E2E_ALLOW_WRITES=1 (CI، Supabase محلي).

interface Row {
  id: string;
  status: string;
  decided_by_name: string | null;
  decision_note: string | null;
}

async function listRows(client: SupabaseClient, tab: 'pending' | 'decided'): Promise<Row[]> {
  const { data, error } = await client.rpc('list_driver_requests', { p_status: tab });
  if (error) throw error;
  return data as Row[];
}

const line = (page: Page, r: SeededDriverRequest): Locator =>
  page.locator(`[data-request-phone="${r.phone}"]`);

test.describe.serial('driver requests (staff is refused)', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'staff');
  });
  test.afterAll(async () => page.context().close());

  test('direct link shows "not authorized", and there is no link or badge', async () => {
    await page.goto('/driver-requests');
    await expectNotAuthorized(page);
    await page.goto('/');
    await expect(sidebarLinks(page).filter({ hasText: /الإعدادات|السواق/ })).toHaveCount(0);
    await expect(page.getByTestId('driver-requests-badge')).toHaveCount(0);
  });

  test('the database refuses the staff member too (list and decide)', async () => {
    const staff = await signedInClient(ACCOUNTS.staff);
    const list = await staff.rpc('list_driver_requests', { p_status: 'pending' });
    expect(list.error).not.toBeNull();
    const decide = await staff.rpc('decide_driver_request', {
      p_id: '00000000-0000-0000-0000-000000000000',
      p_approve: false,
    });
    expect(decide.error).not.toBeNull();
  });
});

test.describe.serial('driver requests (admin, read)', () => {
  let page: Page;
  let admin: SupabaseClient;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
    admin = await signedInClient(ACCOUNTS.admin);
  });
  test.afterAll(async () => page.context().close());

  test('opens with both tabs; the pending badge equals the database count', async () => {
    await page.goto('/driver-requests');
    await expect(page.getByRole('heading', { level: 1, name: 'طلبات السواق' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'بانتظار الموافقة' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'آخر القرارات' })).toBeVisible();
    const pending = await listRows(admin, 'pending');
    const badge = page.getByTestId('driver-requests-badge');
    if (pending.length === 0) await expect(badge).toHaveCount(0);
    else await expect(badge).toHaveText(String(pending.length));
    await expect(page.getByTestId('driver-requests-list').locator('article')).toHaveCount(
      pending.length,
    );
  });

  test('reachable from the staff page, and the settings item stays active', async () => {
    await page.goto('/staff');
    await page.getByRole('link', { name: 'طلبات السواق' }).click();
    await expect(page).toHaveURL(/\/driver-requests$/);
    await expect(
      page
        .getByRole('navigation', { name: 'القائمة الرئيسية' })
        .getByRole('link', { name: /الإعدادات والموظفون/ }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

test.describe.serial('driver requests (admin, decisions)', () => {
  test.skip(!ALLOW_WRITES, 'writes need E2E_ALLOW_WRITES=1 (local Supabase in CI)');
  let page: Page;
  let admin: SupabaseClient;
  let toApprove: SeededDriverRequest;
  let toReject: SeededDriverRequest;
  let raced: SeededDriverRequest;
  let withdrawn: SeededDriverRequest;

  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
    admin = await signedInClient(ACCOUNTS.admin);
    toApprove = await seedDriverRequest('موافقة');
    toReject = await seedDriverRequest('رفض');
    raced = await seedDriverRequest('سباق');
    withdrawn = await seedDriverRequest('سحب');
    const approved = await admin.rpc('decide_driver_request', {
      p_id: withdrawn.id,
      p_approve: true,
    });
    if (approved.error) throw approved.error;
  });
  test.afterAll(async () => page.context().close());

  test('seeded requests show name, phone (tel link, copy) and "since"; the badge counts them', async () => {
    await page.goto('/driver-requests');
    const row = line(page, toApprove);
    await expect(row).toContainText(toApprove.name);
    await expect(row).toContainText(toApprove.phone);
    await expect(row).toContainText(/الآن|منذ/);
    await expect(row.getByRole('link', { name: 'اتصال' })).toHaveAttribute(
      'href',
      `tel:+964${toApprove.phone.slice(1)}`,
    );
    await expect(row.getByRole('button', { name: 'نسخ الرقم' })).toBeVisible();
    const pending = await listRows(admin, 'pending');
    await expect(page.getByTestId('driver-requests-badge')).toHaveText(String(pending.length));
  });

  test('approving is impossible without the "I called and confirmed" box; then it works', async () => {
    await page.goto('/driver-requests');
    const before = (await listRows(admin, 'pending')).length;
    await line(page, toApprove).getByRole('button', { name: 'موافقة' }).click();
    const dialog = page.getByTestId('approve-dialog');
    await expect(dialog).toContainText(`اتصلت بالرقم ${toApprove.phone} وتأكدت أنه نفس الشخص؟`);
    const submit = dialog.getByRole('button', { name: 'موافقة', exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('اتصلت وتأكدت').check();
    await expect(submit).toBeEnabled();
    await dialog.getByLabel('اتصلت وتأكدت').uncheck();
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('اتصلت وتأكدت').check();
    await submit.click();

    await expect(dialog).toHaveCount(0);
    await expect(line(page, toApprove)).toHaveCount(0);
    // الشارة تساوي عدد المعلّق بعد القرار
    const badge = page.getByTestId('driver-requests-badge');
    if (before - 1 === 0) await expect(badge).toHaveCount(0);
    else await expect(badge).toHaveText(String(before - 1));
    expect((await listRows(admin, 'pending')).length).toBe(before - 1);
  });

  test('rejecting takes an optional note; both decisions show in "last decisions" with the admin name', async () => {
    await page.goto('/driver-requests');
    await line(page, toReject).getByRole('button', { name: 'رفض' }).click();
    const dialog = page.getByTestId('reject-dialog');
    await dialog.getByLabel('ملاحظة (اختيارية)').fill('الرقم ما يرد');
    await dialog.getByRole('button', { name: 'رفض الطلب' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(line(page, toReject)).toHaveCount(0);

    await page.getByRole('tab', { name: 'آخر القرارات' }).click();
    const approved = line(page, toApprove);
    await expect(approved.getByTestId('request-status')).toHaveText('موافَق عليه');
    const rejected = line(page, toReject);
    await expect(rejected.getByTestId('request-status')).toHaveText('مرفوض');
    await expect(rejected.getByTestId('request-note')).toHaveText('الرقم ما يرد');
    // اسم الأدمن الذي قرر (من قاعدة البيانات)
    const decided = await listRows(admin, 'decided');
    const adminName = decided.find((r) => r.status === 'rejected')?.decided_by_name;
    expect(adminName).toBeTruthy();
    await expect(rejected.getByTestId('request-decider')).toContainText(adminName ?? '');
    // لا أزرار قرار بتبويب القرارات: قرار واحد لكل طلب
    await expect(approved.getByRole('button', { name: 'موافقة', exact: true })).toHaveCount(0);
  });

  test('R1 M1: an approved request can be withdrawn from "last decisions" (audited), and only once', async () => {
    await page.goto('/driver-requests');
    await page.getByRole('tab', { name: 'آخر القرارات' }).click();
    const row = line(page, withdrawn);
    await expect(row.getByTestId('request-status')).toHaveText('موافَق عليه');
    await row.getByRole('button', { name: 'سحب الموافقة' }).click();
    const dialog = page.getByTestId('reject-dialog');
    await dialog.getByLabel('ملاحظة (اختيارية)').fill('اتصل صاحب الرقم وأنكر');
    await dialog.getByRole('button', { name: 'سحب الموافقة' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByTestId('request-status')).toHaveText('مرفوض');
    await expect(row.getByRole('button', { name: 'سحب الموافقة' })).toHaveCount(0);

    const { data, error } = await admin
      .from('admin_audit')
      .select('before, after')
      .eq('action', 'driver_request')
      .eq('target_id', withdrawn.id)
      .order('created_at', { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(data?.[0]?.before).toMatchObject({ status: 'approved' });
    expect(data?.[0]?.after).toMatchObject({ status: 'rejected', note: 'اتصل صاحب الرقم وأنكر' });
    const again = await admin.rpc('decide_driver_request', {
      p_id: withdrawn.id,
      p_approve: false,
    });
    expect(again.error?.message).toBe('REQUEST_ALREADY_DECIDED');
  });

  test('the database allows one decision per request, and every decision is audited', async () => {
    const again = await admin.rpc('decide_driver_request', {
      p_id: toReject.id,
      p_approve: false,
    });
    expect(again.error?.message).toBe('REQUEST_ALREADY_DECIDED');

    const { data, error } = await admin
      .from('admin_audit')
      .select('target_id, action, after')
      .eq('action', 'driver_request')
      .in('target_id', [toApprove.id, toReject.id]);
    expect(error).toBeNull();
    const byId = new Map((data ?? []).map((r) => [r.target_id as string, r]));
    expect(byId.get(toApprove.id)?.after).toMatchObject({ status: 'approved' });
    expect(byId.get(toReject.id)?.after).toMatchObject({
      status: 'rejected',
      note: 'الرقم ما يرد',
    });
  });

  test('a request decided elsewhere meanwhile: clear message, the list refreshes', async () => {
    await page.goto('/driver-requests');
    await expect(line(page, raced)).toBeVisible();
    await line(page, raced).getByRole('button', { name: 'رفض' }).click();
    // أدمن آخر (أو تبويب آخر) يحسمه قبل الضغط
    const first = await admin.rpc('decide_driver_request', { p_id: raced.id, p_approve: false });
    expect(first.error).toBeNull();
    const dialog = page.getByTestId('reject-dialog');
    await dialog.getByRole('button', { name: 'رفض الطلب' }).click();
    await expect(dialog.getByTestId('decision-error')).toHaveText(
      'هذا الطلب انحسم قبل، حدّث الصفحة',
    );
    await dialog.getByRole('button', { name: 'إلغاء' }).click();
    await expect(line(page, raced)).toHaveCount(0);
  });
});
