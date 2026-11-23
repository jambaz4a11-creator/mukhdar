// Live smoke: demo sign-in on the deployed customer PWA, driver PWA and admin panel (mukhdar-dev).
// READ-ONLY: signs in and checks the first screen loads; never places, accepts or edits anything.
// Credentials only from the environment (GitHub secrets in CI) or the git-ignored .env.local locally;
// nothing is printed. Accounts: seed-demo customer 07000000101, driver 07000000011, admin 07000000001.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { totp } from '../../../scripts/lib/totp.mjs';

const CUSTOMER_URL = process.env.SMOKE_CUSTOMER_URL ?? 'https://mukhdar-app.pages.dev';
const DRIVER_URL = process.env.SMOKE_DRIVER_URL ?? 'https://mukhdar-driver.pages.dev';
const ADMIN_URL = process.env.SMOKE_ADMIN_URL ?? 'https://mukhdar-admin.jambaz4a11.workers.dev';

function secret(envName: string, localName: string): string {
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const text = readFileSync(join(__dirname, '..', '..', '..', '.env.local'), 'utf8');
    const v = new RegExp(`^${localName}=(.*)$`, 'm').exec(text)?.[1]?.trim();
    if (v) return v;
  } catch {
    // no .env.local (CI): fall through
  }
  throw new Error(`${envName} is not set (GitHub secret ${localName})`);
}

/** Function calls blocked by CORS / offline show this; it must never appear after a sign-in. */
const CANT_CONNECT = /تعذّر الاتصال/;

function watchAuth(page: Page, seen: number[]) {
  page.on('response', (r) => {
    if (r.url().includes('/auth/v1/token')) seen.push(r.status());
  });
}

test('customer PWA: demo customer signs in and sees the catalog', async ({ page }) => {
  const statuses: number[] = [];
  watchAuth(page, statuses);
  await page.goto(`${CUSTOMER_URL}/auth/sign-in`);
  const inputs = page.locator('input');
  await inputs.nth(0).fill('07000000101');
  await inputs.nth(1).fill(secret('SMOKE_PIN', 'DEMO_PIN'));
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30_000 });
  expect(statuses).toContain(200);
  await expect(page.getByRole('button', { name: /^أضف .+ للسلة$/ }).first()).toBeVisible();
  await expect(page.getByText(CANT_CONNECT)).toHaveCount(0);
});

test('driver PWA: demo driver signs in', async ({ page }) => {
  const statuses: number[] = [];
  watchAuth(page, statuses);
  await page.goto(`${DRIVER_URL}/auth/login`);
  const inputs = page.locator('input');
  await inputs.nth(0).fill('07000000011');
  await inputs.nth(1).fill(secret('SMOKE_DRIVER_PIN', 'DRIVER_DEMO_PIN'));
  await page.getByTestId('login-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30_000 });
  expect(statuses).toContain(200);
  await expect(page.getByText(CANT_CONNECT)).toHaveCount(0);
});

test('admin panel: demo admin signs in with PIN + TOTP', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`);
  await expect(page.locator('form[data-ready="true"]')).toBeVisible();
  await page.getByLabel('رقم الهاتف').fill('07000000001');
  await page.getByLabel('رمز الدخول (PIN)').fill(secret('SMOKE_PIN', 'DEMO_PIN'));
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/mfa', { timeout: 30_000 });
  // a code about to expire may be rejected by the time it arrives: wait for a fresh window
  const intoWindow = Math.floor(Date.now() / 1000) % 30;
  if (intoWindow > 24) await page.waitForTimeout((31 - intoWindow) * 1000);
  await page
    .getByLabel('رمز تطبيق المصادقة')
    .fill(totp(secret('SMOKE_TOTP_SECRET', 'DEMO_TOTP_SECRET')));
  await page.getByRole('button', { name: /^(دخول|تفعيل ودخول)$/ }).click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 });
  await expect(page.getByRole('navigation', { name: 'القائمة الرئيسية' })).toBeVisible();
});
