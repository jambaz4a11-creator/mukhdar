import { defineConfig, devices } from '@playwright/test';

// E2E تطبيق الزبون (PWA) على متصفحين: WebKit (Safari الآيفون) وChromium (أندرويد).
//   - ضد النسخة المنشورة (Cloudflare Pages):   E2E_BASE_URL=https://mukhdar-app.pages.dev pnpm test:e2e
//   - محلياً: يبني dist (export:web) ويخدمه على 127.0.0.1:3000:  pnpm test:e2e   (E2E_SKIP_BUILD=1 لاستعمال dist الحالي)
// كلاهما يكتب على mukhdar-dev (حساب مؤقت بالبادئة 9647008 يُحذف بنهاية الاختبار، وتنظيف احتياطي بـ global-teardown).
// يحتاج .env.local بجذر المستودع (SUPABASE_SERVICE_ROLE_KEY) للتنظيف الاحتياطي فقط؛ التطبيق نفسه بالمفتاح المنشور.

// 3000: أصل مسموح بـ ALLOWED_ORIGINS على mukhdar-dev (signup وdelete-account، RUNBOOK §16)؛ أوقف `admin dev` قبل التشغيل.
const PORT = Number(process.env.E2E_PORT ?? 3000);
const deployed = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // حد التسجيل لكل IP (20/ساعة) وحد Auth: بالتتابع
  retries: 0,
  reporter: 'list',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: deployed ?? `http://127.0.0.1:${PORT}`,
    locale: 'ar-IQ',
    timezoneId: 'Asia/Baghdad',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
    { name: 'chromium-android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: deployed
    ? undefined
    : {
        command: process.env.E2E_SKIP_BUILD
          ? `node e2e/serve.mjs ${PORT}`
          : `pnpm export:web && node e2e/serve.mjs ${PORT}`,
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: false,
        timeout: 600_000,
      },
});
