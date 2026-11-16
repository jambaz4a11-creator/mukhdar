import { expect, type Browser, type Page } from '@playwright/test';
import { ACCOUNTS, PIN } from './accounts';

export async function signIn(page: Page, phone: string, pin = PIN) {
  await page.goto('/login');
  // لا نكتب قبل تهيئة الصفحة (M1): قبلها لا يوجد onSubmit.
  await expect(page.locator('form[data-ready="true"]')).toBeVisible();
  await page.getByLabel('رقم الهاتف').fill(phone);
  await page.getByLabel('رمز الدخول (PIN)').fill(pin);
  await page.getByRole('button', { name: 'دخول' }).click();
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
