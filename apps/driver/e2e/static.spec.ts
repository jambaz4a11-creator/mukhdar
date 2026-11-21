// PWA السائق بلا خادم (T37، SPEC-webpush §3 و§6.4): manifest، أيقونات، رؤوس الأمان، RTL، بوابة التثبيت، لا أخطاء CSP.
// يعمل بـ CI بقيم EXPO_PUBLIC وهمية (لا طلب للشبكة قبل الدخول).
import { expect, test } from '@playwright/test';
import { collectErrors, simulateInstalled } from './helpers';

const GATE = 'install-gate';
const IOS_163 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1';

test('manifest is valid and its icons load', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  const m = await res.json();
  expect(m).toMatchObject({
    name: 'سائق المخضر',
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
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);
});

test('security headers: CSP without unsafe-inline for scripts, no-cache for the app shell', async ({
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
  expect((await request.get('/index.html')).headers()['cache-control']).toBe('no-cache');
  expect(res.headers()['x-frame-options']).toBe('DENY');
});

test('page loads in Arabic RTL with no CSP errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  // الشاشة الأولى (البوابة على آيفون، الدخول على أندرويد) ظاهرة: التطبيق اشتغل
  await expect(page.getByTestId(GATE).or(page.getByTestId('login-submit'))).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('install gate', () => {
  test('iPhone Safari tab: gate blocks login and registration', async ({ page }, info) => {
    test.skip(info.project.name !== 'webkit-iphone', 'iPhone user agent only');
    await page.goto('/');
    await expect(page.getByTestId(GATE)).toBeVisible();
    await expect(page.getByText('ثبّت التطبيق أولاً')).toBeVisible();
    // الدخول تحت البوابة لا يُضغط (البوابة تغطي الشاشة)
    const blocked = await page
      .getByTestId('login-submit')
      .click({ timeout: 2_000, trial: true })
      .then(() => false)
      .catch(() => true);
    expect(blocked).toBe(true);
  });

  test('iPhone installed (standalone): no gate, login form works', async ({ page }, info) => {
    test.skip(info.project.name !== 'webkit-iphone', 'iPhone user agent only');
    await simulateInstalled(page);
    await page.goto('/');
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId(GATE)).toHaveCount(0);
  });

  test('Android Chrome: no gate', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-android', 'Android only');
    await page.goto('/');
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId(GATE)).toHaveCount(0);
  });
});

test.describe('iOS below 16.4', () => {
  test.use({ userAgent: IOS_163 });
  test('unsupported-ios: update message even when installed', async ({ page }, info) => {
    test.skip(info.project.name !== 'webkit-iphone', 'once is enough');
    await simulateInstalled(page);
    await page.goto('/');
    await expect(page.getByTestId(GATE)).toBeVisible();
    await expect(page.getByText('جهازك يحتاج تحديث', { exact: true })).toBeVisible();
  });
});
