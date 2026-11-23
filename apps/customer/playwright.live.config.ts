// Live smoke (bug 2026-11-23 follow-up): signs in on the three DEPLOYED apps with demo accounts, read-only.
// Run by .github/workflows/live-smoke.yml after every Cloudflare deploy and every 6 hours.
// Locally: pnpm --filter @mukhdar/customer test:smoke (credentials from the env or the repo's .env.local).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  workers: 1,
  // one retry: a single network hiccup from the runner should not page anyone
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/live-smoke.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    locale: 'ar-IQ',
    // a trace records the sign-in request body (the PIN): never in CI (public repo, artifacts are public)
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: process.env.CI ? 'off' : 'only-on-failure',
  },
});
