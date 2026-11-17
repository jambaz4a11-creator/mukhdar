import { expect, type Browser, type Page } from '@playwright/test';
import { ACCOUNTS, PIN, pinFor } from './accounts';
import { DEV_TOTP_SECRET, freshTotp } from './totp';

/** حسابا العرض اللذان يحتاجان رمز تطبيق المصادقة (T23 C1). */
export const MFA_ACCOUNTS: readonly string[] = [ACCOUNTS.admin, ACCOUNTS.staff];

/** صفحة /mfa: يكتب رمز التطبيق الحالي للسر المعطى. */
export async function completeMfa(page: Page, secret = DEV_TOTP_SECRET) {
  await page.waitForURL((u) => u.pathname === '/mfa');
  await page.getByLabel('رمز تطبيق المصادقة').fill(await freshTotp(secret));
  await page.getByRole('button', { name: /^(دخول|تفعيل ودخول)$/ }).click();
}

/**
 * الدخول بالهاتف والرمز. mfaSecret: يكمل المصادقة الثنائية بعدها (الأدمن والموظف)؛ null = لا يكملها
 * (اختبارات صفحة /mfa نفسها، أو الزبون والسائق). الافتراض: السر التجريبي لحسابي العرض فقط.
 */
export async function signIn(
  page: Page,
  phone: string,
  pin = pinFor(phone),
  mfaSecret: string | null = MFA_ACCOUNTS.includes(phone) && pin === PIN ? DEV_TOTP_SECRET : null,
) {
  await page.goto('/login');
  // لا نكتب قبل تهيئة الصفحة (M1): قبلها لا يوجد onSubmit.
  await expect(page.locator('form[data-ready="true"]')).toBeVisible();
  await page.getByLabel('رقم الهاتف').fill(phone);
  await page.getByLabel('رمز الدخول (PIN)').fill(pin);
  await page.getByRole('button', { name: 'دخول' }).click();
  if (mfaSecret) await completeMfa(page, mfaSecret);
}

/** صفحة بجلسة دور معيّن (دخول واحد لكل مجموعة اختبارات، لحد Auth لكل IP). */
export async function pageAs(browser: Browser, role: keyof typeof ACCOUNTS): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, ACCOUNTS[role]);
  await page.waitForURL((u) => u.pathname === '/');
  return page;
}

export async function expectNotAuthorized(page: Page) {
  await expect(page.getByRole('heading', { name: 'غير مصرح' })).toBeVisible();
}

export function sidebarLinks(page: Page) {
  return page.getByRole('navigation', { name: 'القائمة الرئيسية' }).getByRole('link');
}
