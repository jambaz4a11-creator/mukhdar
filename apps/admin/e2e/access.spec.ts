import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS } from './accounts';
import { expectNotAuthorized, pageAs, sidebarLinks, signIn } from './helpers';

// قبول T16: أدمن وموظف يصلان لـ /، الزبون والسائق "غير مصرح"، الموظف لا يصل لصفحات الأدمن حتى بالرابط،
// والصفحات العامة بلا دخول.

const ADMIN_ONLY = ['/products', '/waste', '/addresses', '/reports', '/staff', '/settings'];
const SHARED = ['/orders', '/stock', '/ratings'];

test.describe('public pages (no sign-in)', () => {
  const pages: [string, string][] = [
    ['/delete-account', 'طلب حذف الحساب'],
    ['/privacy', 'سياسة الخصوصية'],
    ['/terms', 'شروط الاستخدام'],
  ];
  for (const [path, title] of pages) {
    test(`${path} opens without a session`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByTestId('draft-banner')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    });
  }
});

test.describe('anonymous', () => {
  test('/ redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  });

  test('a deep link keeps ?next', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login\?next=%2Forders$/);
  });

  test('wrong PIN shows the Arabic error and stays on /login', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, '135792');
    await expect(page.getByTestId('login-error')).toHaveText('الرقم أو الرمز غير صحيح');
    await expect(page).toHaveURL(/\/login/);
  });

  test('submitting before hydration never puts the phone or PIN in the URL (M1)', async ({
    page,
  }) => {
    // نؤخّر ملفات JS كي تبقى الصفحة بلا hydration، ونرسل بالزر وبـ Enter.
    await page.route('**/_next/static/**/*.js', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto('/login', { waitUntil: 'commit' });
    const phone = page.getByLabel('رقم الهاتف');
    const pin = page.getByLabel('رمز الدخول (PIN)');
    await phone.fill(ACCOUNTS.admin);
    await pin.fill('135792');
    const form = page.locator('form');
    await expect(form).toHaveAttribute('data-ready', 'false');
    await expect(page.getByRole('button', { name: 'دخول' })).toBeDisabled();
    await pin.press('Enter'); // إرسال ضمني: يُمنع لأن زر الإرسال معطّل
    await page.getByRole('button', { name: 'دخول' }).click({ force: true });
    await page.waitForTimeout(500);
    const url = page.url();
    expect(url).not.toContain(ACCOUNTS.admin);
    expect(url).not.toContain('135792');
    expect(url).not.toMatch(/[?&](phone|pin)=/);
    // بعد التهيئة يعمل النموذج عادياً
    await expect(page.locator('form[data-ready="true"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'دخول' })).toBeEnabled();
    expect(page.url()).not.toContain('135792');
  });

  test('invalid phone is caught before calling Supabase', async ({ page }) => {
    await signIn(page, '12345');
    await expect(page.getByTestId('login-error')).toContainText('رقم الهاتف غير صحيح');
  });
});

test.describe.serial('admin', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
  });
  test.afterAll(async () => page.context().close());

  test('lands on / with the full sidebar', async () => {
    // الرئيسية (T25): العنوان تحية بالتصميم المعتمد، فنتحقق من بطاقاتها
    await expect(page.getByTestId('kpi-delivered')).toBeVisible();
    await expect(sidebarLinks(page)).toHaveText([
      /الرئيسية/,
      /الطلبات/,
      /المنتجات والمخزون/,
      /هدر اليوم/,
      /التقييمات/,
      /التقارير والأرباح/,
      /الإعدادات والموظفون/,
      /تغيير الرمز/, // أسفل القائمة (مراجعة T16-T19)
    ]);
  });

  test('opens every page', async () => {
    for (const path of [...ADMIN_ONLY, ...SHARED]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByRole('heading', { name: 'غير مصرح' })).toHaveCount(0);
    }
  });

  test('/login with a session goes to /', async () => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/$/);
  });

  test('signs out', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login\?next=/);
  });
});

test.describe.serial('staff', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'staff');
  });
  test.afterAll(async () => page.context().close());

  test('lands on / with home, orders, stock and ratings only', async () => {
    // الرئيسية (T25): العنوان تحية بالتصميم المعتمد، فنتحقق من بطاقاتها
    await expect(page.getByTestId('kpi-delivered')).toBeVisible();
    await expect(sidebarLinks(page)).toHaveText([
      /الرئيسية/,
      /الطلبات/,
      /المخزون/,
      /التقييمات/,
      /تغيير الرمز/,
    ]);
  });

  test('reaches orders, stock and ratings', async () => {
    for (const path of SHARED) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByRole('heading', { name: 'غير مصرح' })).toHaveCount(0);
    }
  });

  test('cannot reach admin pages even by URL', async () => {
    for (const path of ADMIN_ONLY) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(403);
      await expectNotAuthorized(page);
    }
  });
});

for (const role of ['customer', 'driver'] as const) {
  test(`${role} sees "not authorized" and can sign out`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, ACCOUNTS[role]);
    await expectNotAuthorized(page);
    for (const path of ['/', '/orders']) {
      await page.goto(path);
      await expectNotAuthorized(page);
    }
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await context.close();
  });
}

test('phone layout: the menu button opens the sidebar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, ACCOUNTS.staff);
  await page.waitForURL((u) => u.pathname === '/');
  const nav = page.getByRole('navigation', { name: 'القائمة الرئيسية' });
  await expect(nav).toBeHidden();
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'الطلبات' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(nav).toBeHidden();
  await context.close();
});
