import { expect, test } from '@playwright/test';
import { ACCOUNTS, PIN } from './accounts';
import { completeMfa } from './helpers';

// T23 (M3 + M4 + M7): ترويسات الأمان بكل رد، `?next=` لا يخرج من الأصل، ورسالة الخمول بصفحة الدخول.

const PATHS = ['/login', '/privacy', '/delete-account', '/terms'];

test.describe('security headers (M3)', () => {
  for (const path of PATHS) {
    test(`${path} sends the full set`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const h = res.headers();
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBeTruthy();
      expect(h['permissions-policy']).toContain('camera=()');
      expect(h['strict-transport-security']).toMatch(/max-age=\d{7,}/);
      const csp = h['content-security-policy'] ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=_-]{16,}'/);
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    });
  }

  test('the CSP nonce differs per request and matches the scripts in the page', async ({
    request,
  }) => {
    const a = await request.get('/login');
    const b = await request.get('/login');
    const nonce = (r: typeof a) =>
      /'nonce-([^']+)'/.exec(r.headers()['content-security-policy'] ?? '')?.[1];
    expect(nonce(a)).toBeTruthy();
    expect(nonce(a)).not.toBe(nonce(b));
    expect(await a.text()).toContain(`nonce="${nonce(a)}"`);
  });

  test('a redirect (/ → /login) carries the headers too', async ({ request }) => {
    const res = await request.get('/', { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

test('the login page shows the idle sign-out notice (M7)', async ({ page }) => {
  await page.goto('/login?reason=idle');
  await expect(page.getByTestId('idle-notice')).toContainText('12 ساعة');
  await page.goto('/login');
  await expect(page.getByTestId('idle-notice')).toHaveCount(0);
});

test.describe('open redirect after login (M4)', () => {
  const EVIL = [
    '//evil.example.com',
    '/%09/evil.example.com',
    '/\\evil.example.com',
    'https://evil.example.com',
    'javascript:alert(1)',
  ];
  for (const next of EVIL) {
    test(`?next=${next} never leaves the panel origin`, async ({ page, baseURL }) => {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await expect(page.locator('form[data-ready="true"]')).toBeVisible();
      await page.getByLabel('رقم الهاتف').fill(ACCOUNTS.admin);
      await page.getByLabel('رمز الدخول (PIN)').fill(PIN);
      await page.getByRole('button', { name: 'دخول' }).click();
      await completeMfa(page);
      await page.waitForURL((u) => u.pathname !== '/login' && u.pathname !== '/mfa');
      expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? '').origin);
    });
  }

  test('a safe same-origin ?next is kept', async ({ page }) => {
    await page.goto('/login?next=%2Freports');
    await expect(page.locator('form[data-ready="true"]')).toBeVisible();
    await page.getByLabel('رقم الهاتف').fill(ACCOUNTS.admin);
    await page.getByLabel('رمز الدخول (PIN)').fill(PIN);
    await page.getByRole('button', { name: 'دخول' }).click();
    await completeMfa(page);
    await page.waitForURL((u) => u.pathname === '/reports');
  });
});
