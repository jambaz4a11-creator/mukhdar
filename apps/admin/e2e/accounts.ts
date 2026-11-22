// حسابات العرض من scripts/lib/demo.mjs (seed:demo). الافتراضي = القيم العامة للمكدس المحلي فقط (CI)؛
// ضد mukhdar-dev: DEMO_PIN/DRIVER_DEMO_PIN بـ .env.local بالجذر أو E2E_PIN/E2E_DRIVER_PIN بالبيئة (RUNBOOK §6).
import { demoEnv } from './demoEnv';

export const PIN = demoEnv('E2E_PIN', 'DEMO_PIN') ?? '482915';
// T23 L6: السائقون التجريبيون برمز خاص (هو ما يُسلَّم لمطوّر تطبيق السائق)، لا DEMO_PIN
export const DRIVER_PIN = demoEnv('E2E_DRIVER_PIN', 'DRIVER_DEMO_PIN') ?? '739164';
export const ACCOUNTS = {
  admin: process.env.E2E_ADMIN_PHONE ?? '07000000001',
  staff: process.env.E2E_STAFF_PHONE ?? '07000000002',
  driver: process.env.E2E_DRIVER_PHONE ?? '07000000011',
  customer: process.env.E2E_CUSTOMER_PHONE ?? '07000000101',
} as const;

/** رمز حساب العرض: السائقون 07000000011..13 برمزهم الخاص، والباقي DEMO_PIN. */
export const pinFor = (phone: string): string =>
  /^0700000001[123]$/.test(phone) ? DRIVER_PIN : PIN;
