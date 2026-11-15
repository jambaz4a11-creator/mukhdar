import { defineConfig, devices } from '@playwright/test';

// E2E ضد Supabase (محلي بـ CI مع seed:demo، أو mukhdar-dev محلياً) بحسابات العرض و DEMO_PIN.
// المتغيرات: NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (من .env.local أو البيئة).
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // حد Auth لكل IP: الدخول بالتتابع
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ar-IQ',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `pnpm start -p ${PORT}`
      : `pnpm build && pnpm start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/privacy`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
