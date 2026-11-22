// دخول بحساب سائق تجريبي على PWA (T37): الآيفون المثبَّت (WebKit + standalone) وأندرويد (Chromium).
// على mukhdar-dev فقط، ولا يكتب شيئاً بقاعدة البيانات (دخول ← الطلبات المتاحة ← خروج). يتخطّى بلا إعداد dev.
// الحساب: 07000000011 (seed:demo) والرمز DRIVER_DEMO_PIN (.env.local بالجذر؛ E2E_DRIVER_PHONE/PIN لتغييره).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { demoEnv } from '../../admin/e2e/demoEnv';
import { collectErrors, simulateInstalled } from './helpers';

function readEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const text = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    return new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const DEV_URL = 'https://ghcohlrzvehtcettaaiu.';
const PHONE = process.env.E2E_DRIVER_PHONE ?? '07000000011';
// رمز سائقي العرض على mukhdar-dev: من البيئة أو .env.local بالجذر فقط (لا قيمة عامة؛ RUNBOOK §6)
const PIN = demoEnv('E2E_DRIVER_PIN', 'DRIVER_DEMO_PIN');
const SECURE_KEYS = /access_token|refresh_token|eyJ[A-Za-z0-9_-]{10,}\./;

test('demo driver signs in on the PWA, session is not stored in clear text', async ({
  page,
}, info) => {
  const url = readEnv('EXPO_PUBLIC_SUPABASE_URL');
  const key = readEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ?? '';
  test.skip(
    !PIN ||
      (!process.env.E2E_BASE_URL && (!url?.startsWith(DEV_URL) || key.includes('placeholder'))),
    'needs apps/driver/.env pointing at mukhdar-dev and DRIVER_DEMO_PIN in the root .env.local',
  );
  const errors = collectErrors(page);
  if (info.project.name === 'webkit-iphone') await simulateInstalled(page);

  await page.goto('/');
  await page.getByTestId('phone-input').fill(PHONE);
  await page.getByTestId('pin-input').fill(PIN ?? '');
  await page.getByTestId('login-submit').click();

  // الطلبات المتاحة (التبويب الأول) بعد الدخول
  await expect(page.getByTestId('ready-count')).toBeVisible({ timeout: 30_000 });

  // لا نص صريح للجلسة بتخزين المتصفح (T34: مشفّرة بمفتاح غير قابل للتصدير بـ IndexedDB)
  const stored = await page.evaluate(() => {
    const all: string[] = [];
    for (const s of [localStorage, sessionStorage]) {
      for (let i = 0; i < s.length; i++) all.push(`${s.key(i)}=${s.getItem(s.key(i) ?? '')}`);
    }
    return all.join('\n');
  });
  expect(stored).not.toMatch(SECURE_KEYS);
  expect(errors).toEqual([]);
});
