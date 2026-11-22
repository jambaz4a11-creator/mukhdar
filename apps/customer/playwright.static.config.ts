import { defineConfig, devices } from '@playwright/test';

// R3 L7: فحص PWA الزبون بلا خادم ولا حساب (CI، job web-builds): static.spec.ts فقط، على WebKit وChromium.
// يخدم dist الحالي مع dist/_headers (E2E_SKIP_BUILD=1) أو يبنيه. لا global-teardown (لا كتابة على أي مشروع).
const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'static.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ar-IQ',
    timezoneId: 'Asia/Baghdad',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
    { name: 'chromium-android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `node e2e/serve.mjs ${PORT}`
      : `pnpm export:web && node e2e/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
