import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, PIN } from './accounts';
import { pageAs, signIn } from './helpers';
import { ALLOW_WRITES, signedInClient } from './supabase';
import { freshTotp } from './totp';

// T19: الإعدادات والموظفون والعناوين. القراءة (ومحاولات تُرفض بلا كتابة) تعمل على أي بيانات seed؛
// الكتابة (حفظ الإعدادات، ترقية، تصفير رمز، إنشاء سائق، عمارات) فقط مع E2E_ALLOW_WRITES=1
// (CI: Supabase محلي مع Edge Functions).

// زبائن العرض 07000000101..112 لـ placeOrder (orders.spec)؛ هنا آخر الزبائن فقط.
const RESET_CUSTOMER = '07000000119';
const PROMOTE_CUSTOMER = '07000000120';

/**
 * place_order يفحص حد الطلبات المفتوحة قبل حالة المتجر، فنختار زبوناً تحت الحد (113..118: لا
 * يستعملها placeOrder) حتى يكون الرفض STORE_CLOSED نفسه.
 */
async function customerBelowOpenLimit() {
  for (let n = 113; n <= 118; n++) {
    const client = await signedInClient(`07000000${n}`);
    const { count } = await client
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'preparing', 'ready', 'out_for_delivery']);
    if ((count ?? 0) < 3) return client;
  }
  throw new Error('no demo customer below the open-orders limit');
}

function userLine(page: Page, phone: string) {
  return page.locator(`[data-user-phone="${phone}"]`);
}

test.describe.serial('settings, staff, addresses (admin, read / refused)', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
  });
  test.afterAll(async () => page.context().close());

  test('settings form shows the current values; minimum 1100 is rejected by the form', async () => {
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { level: 1, name: 'الإعدادات والموظفون' }),
    ).toBeVisible();
    const min = page.getByLabel('الحد الأدنى للطلب');
    await expect(min).not.toHaveValue('');
    await expect(page.getByTestId('stuck-notifications')).toBeVisible();
    await min.fill('1100');
    await page.getByRole('button', { name: 'حفظ الإعدادات' }).click();
    await expect(page.getByTestId('error-min_order_iqd')).toContainText('مضاعفات 250');
    await expect(page.getByTestId('settings-saved')).toHaveCount(0);
  });

  test('staff list shows non-customers; the admin cannot demote themself', async () => {
    await page.goto('/staff');
    const me = userLine(page, ACCOUNTS.admin).first();
    await expect(me).toContainText('(أنت)');
    await expect(userLine(page, ACCOUNTS.staff).first()).toContainText('موظف');
    await expect(userLine(page, ACCOUNTS.driver).first()).toContainText('سائق');
    // لا تصفير رمز لحساب أدمن
    await expect(me.getByRole('button', { name: 'تصفير الرمز' })).toHaveCount(0);
    await me.getByLabel(/^الدور لـ/).selectOption('staff');
    await expect(me.getByTestId('role-error')).toContainText('لا يمكنك تغيير دورك');
    await expect(me.getByRole('combobox')).toHaveValue('admin');
    // الخانة ترجع لحالة الخادم بعد الرفض، فـ click لا uncheck (uncheck يتوقع تغيّر الحالة)
    await me.getByRole('checkbox').click();
    await expect(me.getByTestId('role-error')).toContainText('لا يمكنك تغيير دورك');
    await expect(me.getByRole('checkbox')).toBeChecked();
  });

  test('phone search finds any account (customer)', async () => {
    await page.goto('/staff');
    await page.getByRole('textbox', { name: /بحث برقم الهاتف/ }).fill(PROMOTE_CUSTOMER);
    await page.getByRole('button', { name: 'بحث', exact: true }).click();
    await expect(page.getByTestId('search-result')).toContainText(PROMOTE_CUSTOMER);
  });

  test('addresses: sectors and units; bulk preview ignores existing buildings', async () => {
    await page.goto('/addresses');
    await expect(page.getByRole('heading', { level: 1, name: 'العناوين' })).toBeVisible();
    await expect(page.locator('[data-sector]').first()).toBeVisible();
    await page.locator('[data-unit]').first().getByRole('button').first().click();
    await expect(page.getByTestId('buildings').locator('button').first()).toBeVisible();
    await page.getByLabel('إضافة عمارات بالجملة').fill('1-5');
    await expect(page.getByTestId('bulk-preview')).toContainText('موجودة');
    await page.getByLabel('إضافة عمارات بالجملة').fill('9-5');
    await expect(page.getByText('مقلوب')).toBeVisible();
  });

  test('renaming a unit with saved customer addresses asks for confirmation with the count (M7)', async () => {
    // وحدة عليها عنوان محفوظ لزبون العرض (بلا كتابة: نلغي عند التأكيد، فلا يتغيّر شيء)
    const customer = await signedInClient('07000000115');
    const { data } = await customer
      .from('addresses')
      .select('buildings(subsections(name))')
      .limit(1);
    const unitName = (data?.[0] as unknown as { buildings: { subsections: { name: string } } })
      .buildings.subsections.name;

    await page.goto('/addresses');
    await page.locator(`[data-unit="${unitName}"]`).getByRole('button').first().click();
    const panel = page.getByRole('region', { name: 'العمارات' });
    await panel.getByRole('button', { name: 'تعديل الاسم' }).first().click();
    await panel.getByRole('textbox', { name: /^الاسم الجديد/ }).fill('ZZ9');
    await panel.getByRole('button', { name: 'حفظ', exact: true }).click();
    const confirm = page.getByTestId('rename-confirm');
    await expect(confirm).toContainText('عنوان محفوظ للزبائن');
    await expect(confirm).toContainText(`«${unitName}»`);
    await expect(confirm).toContainText('«ZZ9»');
    await confirm.getByRole('button', { name: 'رجوع' }).click();
    await panel.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await expect(page.locator(`[data-unit="${unitName}"]`)).toBeVisible();
    await expect(page.locator('[data-unit="ZZ9"]')).toHaveCount(0);
  });

  test('building numbers outside 1-100 are refused by the bulk form', async () => {
    await page.goto('/addresses');
    await page.locator('[data-unit]').first().getByRole('button').first().click();
    await page.getByLabel('إضافة عمارات بالجملة').fill('99-101');
    await expect(page.getByText('الأرقام من 1 إلى 100')).toBeVisible();
  });
});

test.describe.serial('settings, staff, addresses (writes)', () => {
  test.skip(!ALLOW_WRITES, 'writes only against a local Supabase (E2E_ALLOW_WRITES=1)');
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
  });
  test.afterAll(async () => page.context().close());

  test('closing the store blocks ordering (STORE_CLOSED), then reopening', async () => {
    await page.goto('/settings');
    await page.getByLabel('المتجر مفتوح').uncheck();
    await page.getByLabel('رسالة الإغلاق').fill('نرجع الساعة 8 الصبح');
    await page.getByRole('button', { name: 'حفظ الإعدادات' }).click();
    await expect(page.getByTestId('settings-saved')).toBeVisible();

    const customer = await customerBelowOpenLimit();
    const { data: s } = await customer
      .from('app_settings')
      .select('store_open, closed_message')
      .single();
    expect(s).toEqual({ store_open: false, closed_message: 'نرجع الساعة 8 الصبح' });
    const { data: addr } = await customer.from('addresses').select('id').limit(1);
    const { data: product } = await customer
      .from('products')
      .select('id')
      .eq('in_stock', true)
      .limit(1);
    const { error } = await customer.rpc('place_order', {
      p_address_id: addr?.[0]?.id,
      p_items: [{ product_id: product?.[0]?.id, qty: 1 }],
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(error?.message).toBe('STORE_CLOSED');

    await page.reload();
    await page.getByLabel('المتجر مفتوح').check();
    await page.getByRole('button', { name: 'حفظ الإعدادات' }).click();
    await expect(page.getByTestId('settings-saved')).toBeVisible();
    const { data: after } = await customer.from('app_settings').select('store_open').single();
    expect(after?.store_open).toBe(true);
  });

  test('promote a phone to driver (and back to customer)', async () => {
    await page.goto('/staff');
    await page.getByRole('textbox', { name: /بحث برقم الهاتف/ }).fill(PROMOTE_CUSTOMER);
    await page.getByRole('button', { name: 'بحث', exact: true }).click();
    const result = page.getByTestId('search-result');
    await result.getByLabel(/^الدور لـ/).selectOption('driver');
    await expect(userLine(page, PROMOTE_CUSTOMER).first().getByTestId('role-badge')).toHaveText(
      'سائق',
    );
    await expect(
      page.getByTestId('staff-list').locator(`[data-user-phone="${PROMOTE_CUSTOMER}"]`),
    ).toBeVisible();
    // رجوع: زبون، ويختفي من القائمة
    await result.getByLabel(/^الدور لـ/).selectOption('customer');
    await expect(
      page.getByTestId('staff-list').locator(`[data-user-phone="${PROMOTE_CUSTOMER}"]`),
    ).toHaveCount(0);
  });

  test('reset a customer PIN: shown once with copy and WhatsApp; the new PIN signs in', async () => {
    await page.goto('/staff');
    await page.getByRole('textbox', { name: /بحث برقم الهاتف/ }).fill(RESET_CUSTOMER);
    await page.getByRole('button', { name: 'بحث', exact: true }).click();
    await page.getByTestId('search-result').getByRole('button', { name: 'تصفير الرمز' }).click();
    const dialog = page.getByTestId('reset-pin-dialog');
    await expect(dialog.getByTestId('reset-rules')).toContainText(RESET_CUSTOMER);
    await expect(dialog.getByTestId('reset-rules')).toContainText('سؤالين عن آخر طلب');
    await dialog.getByLabel('الرمز (6 أرقام)').fill('123456');
    await dialog.getByRole('button', { name: 'ضبط الرمز الجديد' }).click();
    await expect(dialog.getByTestId('error-reset-pin')).toContainText('سهل');
    await dialog.getByRole('button', { name: 'رمز عشوائي' }).click();
    await dialog.getByRole('button', { name: 'ضبط الرمز الجديد' }).click();
    const pin = (await dialog.getByTestId('pin-value').innerText()).trim();
    expect(pin).toMatch(/^[0-9]{6}$/);
    await expect(dialog.getByTestId('pin-whatsapp')).toHaveAttribute(
      'href',
      new RegExp(`^https://wa\\.me/964${RESET_CUSTOMER.slice(1)}\\?text=.*${pin}`),
    );
    await dialog.getByRole('button', { name: 'تم، أغلق' }).click();
    await expect(page.getByTestId('pin-value')).toHaveCount(0);

    const customer = await signedInClient(RESET_CUSTOMER, pin); // يرمي إن فشل
    await expect(signedInClient(RESET_CUSTOMER, PIN)).rejects.toThrow();

    // رمز مؤقت: الطلب يُرفض حتى يغيّره (مراجعة T16-T19، must_change_pin)
    const flagged = await customer.from('profiles').select('must_change_pin').single();
    expect(flagged.data?.must_change_pin).toBe(true);
    const { error: blocked } = await customer.rpc('place_order', {
      p_address_id: crypto.randomUUID(),
      p_items: [],
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(blocked?.message).toBe('PIN_CHANGE_REQUIRED');

    // الزبون يغيّر رمزه (يرجع رمز العرض للتشغيل التالي) ← العلامة تُمسح
    const { error: changeError } = await customer.auth.updateUser({ password: PIN });
    expect(changeError).toBeNull();
    const cleared = await customer.from('profiles').select('must_change_pin').single();
    expect(cleared.data?.must_change_pin).toBe(false);
    await signedInClient(RESET_CUSTOMER, PIN);
  });

  test('a new staff member must change the temporary PIN before using the panel', async ({
    browser,
  }) => {
    const phone = `0791${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
    await page.goto('/staff');
    await page.getByRole('button', { name: '+ إضافة موظف أو سائق' }).click();
    const dialog = page.getByTestId('create-user-dialog');
    await dialog.getByLabel('رقم الهاتف').fill(phone);
    await dialog.getByLabel('الاسم', { exact: true }).fill('موظف Playwright');
    await dialog.getByLabel('موظف', { exact: true }).check();
    await dialog.getByRole('button', { name: 'رمز عشوائي' }).click();
    await dialog.getByRole('button', { name: 'إنشاء الحساب' }).click();
    const temp = (await dialog.getByTestId('pin-value').innerText()).trim();
    await dialog.getByRole('button', { name: 'تم، أغلق' }).click();
    await expect(userLine(page, phone).first().getByTestId('temp-pin')).toBeVisible();

    const context = await browser.newContext();
    const staff = await context.newPage();
    await signIn(staff, phone, temp, null);
    // T23 C1: أول دخول ← تسجيل تطبيق المصادقة (QR + المفتاح اليدوي) قبل أي شيء، حتى تغيير الرمز
    await staff.waitForURL((u) => u.pathname === '/mfa');
    await expect(staff.getByTestId('mfa-enroll-intro')).toBeVisible();
    await expect(staff.getByTestId('mfa-qr')).toBeVisible();
    const secret = (await staff.getByTestId('mfa-secret').innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    await staff.goto('/orders'); // أي صفحة ← /mfa
    await staff.waitForURL((u) => u.pathname === '/mfa');
    await staff.getByLabel('رمز تطبيق المصادقة').fill('000000');
    await staff.getByRole('button', { name: 'تفعيل ودخول' }).click();
    await expect(staff.getByTestId('mfa-error')).toBeVisible();
    // نفس التسجيل ما زال معروضاً (نفس السر) بعد الرمز الخاطئ
    const current = (await staff.getByTestId('mfa-secret').innerText()).trim();
    await staff.getByLabel('رمز تطبيق المصادقة').fill(await freshTotp(current));
    await staff.getByRole('button', { name: 'تفعيل ودخول' }).click();
    await staff.waitForURL((u) => u.pathname === '/change-pin');
    await expect(staff.getByTestId('pin-forced')).toBeVisible();
    await staff.goto('/orders'); // أي صفحة ← تغيير الرمز
    await staff.waitForURL((u) => u.pathname === '/change-pin');

    const fresh = temp === '583926' ? '692817' : '583926';
    await staff.getByLabel('الرمز المؤقت').fill(temp);
    await staff.getByLabel('رمز تطبيق المصادقة').fill(await freshTotp(current));
    await staff.getByLabel('الرمز الجديد', { exact: true }).fill(fresh);
    await staff.getByLabel('أعد كتابة الرمز الجديد').fill(fresh);
    await staff.getByRole('button', { name: 'تغيير الرمز' }).click();
    await staff.waitForURL((u) => u.pathname === '/');
    await staff.goto('/orders');
    await expect(staff).toHaveURL(/\/orders$/);
    await context.close();

    await page.reload();
    await expect(userLine(page, phone).first().getByTestId('temp-pin')).toHaveCount(0);

    // كل دخول بعدها: الـ PIN ثم رمز التطبيق
    const again = await browser.newContext();
    const staff2 = await again.newPage();
    await signIn(staff2, phone, fresh, current);
    await staff2.waitForURL((u) => u.pathname === '/');
    // رمز خاطئ يبقى على /mfa
    const third = await browser.newContext();
    const staff3 = await third.newPage();
    await signIn(staff3, phone, fresh, null);
    await staff3.waitForURL((u) => u.pathname === '/mfa');
    await expect(staff3.getByTestId('mfa-enroll-intro')).toHaveCount(0);
    await staff3.getByLabel('رمز تطبيق المصادقة').fill('000000');
    await staff3.getByRole('button', { name: 'دخول' }).click();
    await expect(staff3.getByTestId('mfa-error')).toBeVisible();
    await expect(staff3).toHaveURL(/\/mfa/);
    await third.close();

    // الأدمن يعيد ضبط مصادقة الموظف (فقد هاتفه): مُدقَّق، ويخرج من كل الأجهزة، وأول دخول يسجّل من جديد
    page.once('dialog', (d) => void d.accept());
    await userLine(page, phone).first().getByTestId('mfa-reset').click();
    await expect(userLine(page, phone).first().getByTestId('mfa-reset-done')).toBeVisible();
    const admin = await signedInClient(ACCOUNTS.admin);
    const { data: audit } = await admin
      .from('admin_audit')
      .select('action, after')
      .eq('action', 'mfa_reset')
      .order('id', { ascending: false })
      .limit(1);
    expect(audit?.[0]?.after).toMatchObject({ factors: 0, via: 'panel' });
    await staff2.goto('/orders');
    await staff2.waitForURL((u) => u.pathname === '/login'); // الجلسة أُبطلت
    await again.close();
    const fourth = await browser.newContext();
    const staff4 = await fourth.newPage();
    await signIn(staff4, phone, fresh, null);
    await staff4.waitForURL((u) => u.pathname === '/mfa');
    await expect(staff4.getByTestId('mfa-enroll-intro')).toBeVisible();
    await expect(staff4.getByTestId('mfa-qr')).toBeVisible();
    await fourth.close();
  });

  test('2FA of an admin cannot be reset from the panel (break-glass only)', async () => {
    const admin = await signedInClient(ACCOUNTS.admin);
    const { data: me } = await admin.auth.getUser();
    const { error } = await admin.rpc('admin_reset_mfa', { p_user_id: me.user?.id ?? '' });
    expect(error?.message).toBe('ADMIN_ACCOUNT');
    await page.goto('/staff');
    await expect(userLine(page, ACCOUNTS.admin).first().getByTestId('mfa-reset')).toHaveCount(0);
  });

  test('create a driver: PIN shown once, signs in, listed; the same phone → "registered"', async () => {
    const phone = `0790${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
    await page.goto('/staff');
    await page.getByRole('button', { name: '+ إضافة موظف أو سائق' }).click();
    const dialog = page.getByTestId('create-user-dialog');
    await dialog.getByLabel('رقم الهاتف').fill(phone);
    await dialog.getByLabel('الاسم', { exact: true }).fill('سائق Playwright');
    await dialog.getByLabel('سائق', { exact: true }).check();
    await dialog.getByRole('button', { name: 'رمز عشوائي' }).click();
    await dialog.getByRole('button', { name: 'إنشاء الحساب' }).click();
    const pin = (await dialog.getByTestId('pin-value').innerText()).trim();
    expect(pin).toMatch(/^[0-9]{6}$/);
    await dialog.getByRole('button', { name: 'تم، أغلق' }).click();
    await expect(userLine(page, phone).first().getByTestId('role-badge')).toHaveText('سائق');

    const driver = await signedInClient(phone, pin);
    const { data: me } = await driver.from('profiles').select('role').single();
    expect(me?.role).toBe('driver');

    await page.getByRole('button', { name: '+ إضافة موظف أو سائق' }).click();
    await dialog.getByLabel('رقم الهاتف').fill(phone);
    await dialog.getByLabel('الاسم', { exact: true }).fill('مكرر');
    await dialog.getByRole('button', { name: 'رمز عشوائي' }).click();
    await dialog.getByRole('button', { name: 'إنشاء الحساب' }).click();
    await expect(dialog.getByRole('alert')).toContainText('الرقم مسجّل');
    await dialog.getByRole('button', { name: 'ترقية هذا الرقم' }).click();
    await expect(page.getByRole('textbox', { name: /بحث برقم الهاتف/ })).toHaveValue(phone);
  });

  test('add buildings in bulk to a new unit: 1-100 in one go, duplicates ignored', async () => {
    const unitName = `Z${Math.floor(Math.random() * 900 + 100)}`;
    await page.goto('/addresses');
    const sector = page.locator('[data-sector]').first();
    await sector.getByRole('button', { name: /^\+ وحدة جديدة/ }).click();
    await sector.getByLabel(/^وحدة جديدة/).fill(unitName);
    await sector.getByRole('button', { name: 'إضافة', exact: true }).click();
    await sector.locator(`[data-unit="${unitName}"]`).getByRole('button').first().click();
    const bulk = page.getByLabel('إضافة عمارات بالجملة');
    await bulk.fill('1-100');
    await expect(page.getByTestId('bulk-preview')).toContainText('100');
    await page.getByRole('button', { name: 'إضافة 100 عمارة' }).click();
    await expect(page.getByTestId('bulk-result')).toContainText(
      `انضافت 100 عمارة لوحدة ${unitName}`,
    );
    await expect(page.getByTestId('buildings').locator('button')).toHaveCount(100);
    // كلها موجودة الآن: لا شيء جديد للإضافة (المكرر يُتجاهل)
    await bulk.fill('1,2,5-9');
    await expect(page.getByTestId('bulk-preview')).toContainText('كل الأرقام موجودة أصلاً');
    // 101 خارج 1..100 (قيد قاعدة البيانات أيضاً): الواجهة ترفضه قبل الإرسال
    await bulk.fill('1,2,5-9, 101');
    await expect(page.getByText('الأرقام من 1 إلى 100')).toBeVisible();
    // إخفاء الوحدة التجريبية (لا حذف)
    await page
      .getByRole('region', { name: 'العمارات' })
      .getByRole('button', { name: 'إخفاء' })
      .first()
      .click();
    await expect(sector.locator(`[data-unit="${unitName}"]`)).toContainText('مخفية');
  });
});
