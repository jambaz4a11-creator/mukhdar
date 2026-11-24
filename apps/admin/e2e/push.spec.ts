import { expect, test, type Page } from '@playwright/test';
import { pageAs } from './helpers';

// T44 (SPEC-admin-push §3–§5): اللوحة قابلة للتثبيت (manifest + sw.js بلا جلسة)، "تنبيهات هذا الجهاز"، شريط "فعّل الصوت".
// لا اشتراك حقيقي هنا (لا خدمة دفع بالـ CI ولا كتابة على أي قاعدة): push-config يُحاكى بالمتصفح.

const KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

async function stubPushConfig(page: Page, status: number) {
  await page.route('**/functions/v1/push-config', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204 })
      : route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(
            status === 200 ? { vapid_public_key: KEY } : { error: 'NOT_CONFIGURED' },
          ),
        }),
  );
}

test.describe('installable panel (no session needed)', () => {
  test('manifest: Arabic RTL standalone app with icons, served without a redirect', async ({
    request,
  }) => {
    const res = await request.get('/manifest.webmanifest', { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('manifest+json');
    const m = await res.json();
    expect(m).toMatchObject({
      name: 'لوحة المخضر',
      lang: 'ar',
      dir: 'rtl',
      display: 'standalone',
      start_url: '/',
    });
    for (const icon of m.icons as { src: string }[]) {
      const img = await request.get(icon.src, { maxRedirects: 0 });
      expect(img.status(), icon.src).toBe(200);
      expect(img.headers()['content-type']).toContain('image/png');
    }
  });

  test('sw.js: JavaScript, never cached, root scope, no redirect to /login', async ({
    request,
  }) => {
    const res = await request.get('/sw.js', { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/javascript/);
    expect(res.headers()['cache-control']).toContain('no-cache');
    expect(res.headers()['service-worker-allowed']).toBe('/');
    const body = await res.text();
    expect(body).toContain("addEventListener('push'");
    expect(body).not.toMatch(/addEventListener\(\s*'fetch'/);
  });

  test('pages link the manifest and the apple icon; CSP allows the worker from self only', async ({
    request,
  }) => {
    const res = await request.get('/login');
    const html = await res.text();
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/<link[^>]+rel="apple-touch-icon"[^>]+\/icons\/apple-touch-icon\.png/);
    expect(html).toMatch(/name="(apple-)?mobile-web-app-capable" content="yes"/);
    expect(res.headers()['content-security-policy']).toContain("worker-src 'self'");
  });
});

test.describe('device alerts (staff)', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'staff');
  });
  test.afterAll(async () => page.context().close());

  async function openAlerts() {
    const toggle = page.getByRole('button', { name: /تنبيهات هذا الجهاز/ });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    return page.getByRole('region', { name: 'تنبيهات هذا الجهاز' });
  }

  test('server not configured: says so, offers no button', async () => {
    await stubPushConfig(page, 503);
    await page.goto('/');
    const panel = await openAlerts();
    await expect(panel.getByTestId('device-alerts-status')).toHaveText(
      'الإشعارات غير مهيأة على الخادم بعد',
    );
    await expect(panel.getByRole('button', { name: 'شغّل الإشعارات على هذا الجهاز' })).toHaveCount(
      0,
    );
  });

  test('configured but the browser blocks notifications: how to allow them, no button', async () => {
    await page.unroute('**/functions/v1/push-config');
    await stubPushConfig(page, 200);
    await page.context().clearPermissions(); // Chromium headless: الإشعارات مرفوضة افتراضياً
    await page.goto('/orders');
    const panel = await openAlerts();
    await expect(panel.getByTestId('device-alerts-status')).toHaveAttribute('data-state', 'denied');
    await expect(panel.getByText(/إعدادات الموقع/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'شغّل الإشعارات على هذا الجهاز' })).toHaveCount(
      0,
    );
  });

  test('configured, allowed, not subscribed yet: one button, staff are told what reaches them', async () => {
    await page.unroute('**/functions/v1/push-config');
    await stubPushConfig(page, 200);
    // Chromium بلا واجهة يبقي Notification.permission = 'denied' حتى بعد grantPermissions (permissions.query تقول
    // granted)، فنحاكي "سمح المستخدم" هنا فقط. لا اشتراك يحدث: الزر لا يُضغط.
    await page.addInitScript(() =>
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' }),
    );
    await page.goto('/orders');
    const panel = await openAlerts();
    // لا اشتراك بعد على هذا المتصفح (التسجيل الصامت لا يشترك من تلقاء نفسه أبداً)
    await expect(panel.getByTestId('device-alerts-status')).toHaveAttribute(
      'data-state',
      'granted-unregistered',
    );
    await expect(
      panel.getByRole('button', { name: 'شغّل الإشعارات على هذا الجهاز' }),
    ).toBeVisible();
    await expect(
      panel.getByText('يوصلك: طلب جديد، إلغاء الزبون لطلبه، ونقص المخزون.'),
    ).toBeVisible();
    await expect(panel.getByText(/طلب سائق/)).toHaveCount(0);
    await expect(panel.getByText(/12 ساعة/)).toBeVisible();
  });

  test('sound: per-device switch hides the unlock banner; "enable sound" unlocks it', async () => {
    const panel = await openAlerts();
    const sound = panel.getByRole('checkbox', { name: /صوت تنبيه الطلبات/ });
    await expect(sound).toBeChecked();
    await sound.uncheck();
    await expect(page.getByTestId('sound-unlock-banner')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('mukhdar.admin.sound'))).toBe('off');
    await sound.check();
    // بدون نقرة بالصفحة الجديدة يبقى الصوت مقفولاً (سياسة المتصفح) والشريط ظاهر؛ زره يفتحه
    await page.goto('/orders');
    const banner = page.getByTestId('sound-unlock-banner');
    if (await banner.isVisible()) {
      await banner.getByRole('button', { name: 'فعّل الصوت' }).click();
      await expect(banner).toHaveCount(0);
    }
  });
});
