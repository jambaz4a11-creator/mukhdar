import { defineConfig, devices } from '@playwright/test';

// E2E تطبيق السائق (PWA، T37) على WebKit (Safari الآيفون) وChromium (أندرويد).
//   - محلياً: يبني dist (export:web) ويخدمه مع dist/_headers على 127.0.0.1:3100:  pnpm test:e2e
//     (E2E_SKIP_BUILD=1 لاستعمال dist الحالي)
//   - ضد النسخة المنشورة:  E2E_BASE_URL=https://mukhdar-driver.pages.dev pnpm test:e2e
// static.spec.ts بلا خادم (CI). login.spec.ts يدخل بحساب سائق تجريبي على mukhdar-dev (محلي فقط، لا يكتب شيئاً).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const deployed = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: deployed ?? `http://127.0.0.1:${PORT}`,
    locale: 'ar-IQ',
    timezoneId: 'Asia/Baghdad',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // وكيل iOS 17.5: ملف iPhone 13 بـ Playwright يعلن iOS أقدم من 16.4 فتظهر بوابة "حدّث جهازك" بدل التثبيت
    {
      name: 'webkit-iphone',
      use: {
        ...devices['iPhone 13'],
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      },
    },
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
