// PWA الزبون بلا خادم (R3 L7، SPEC-webpush §5.2 و§6.4): manifest، رؤوس الأمان، sw.js، RTL، لا أخطاء CSP.
// لا يكتب شيئاً ولا يحتاج حساباً: يعمل بـ CI بقيم EXPO_PUBLIC وهمية (playwright.static.config.ts).
import { expect, test, type Page } from '@playwright/test';

/** أخطاء CSP وأخطاء الصفحة غير الملتقطة فقط (طلبات الشبكة الفاشلة بالمفتاح الوهمي ليست موضوع هذا الفحص). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(text)) {
      errors.push(text);
    }
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test('manifest is valid and its icons load', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  const m = await res.json();
  expect(m).toMatchObject({
    lang: 'ar',
    dir: 'rtl',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    id: '/',
  });
  for (const icon of m.icons as { src: string }[]) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()['content-type'], icon.src).toBe('image/png');
  }
});

test('security headers: CSP without unsafe-inline for scripts, no-cache shell', async ({
  request,
}) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? '';
  expect(scriptSrc).toContain("'self'");
  expect(scriptSrc).not.toContain('unsafe-inline');
  expect(scriptSrc).not.toContain('unsafe-eval');
  for (const d of ["worker-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) {
    expect(csp).toContain(d);
  }
  expect(res.headers()['cache-control']).toBe('no-cache');
  expect(res.headers()['x-frame-options']).toBe('DENY');
});

test('sw.js is served as JavaScript with no-cache, and shows notifications (no fetch handler)', async ({
  request,
}) => {
  const res = await request.get('/sw.js');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('javascript');
  expect(res.headers()['cache-control']).toBe('no-cache');
  const js = await res.text();
  expect(js).toContain('showNotification');
  expect(js).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
});

test('page loads in Arabic RTL with no CSP errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.waitForTimeout(1500); // سكربتات متأخرة (Expo Router) تُحمَّل
  expect(errors).toEqual([]);
});
