// حسابات العرض من scripts/lib/demo.mjs (seed:demo). تطوير فقط: DEMO_PIN منشور ولا يُستخدم بالإنتاج.
export const PIN = process.env.E2E_PIN ?? '482915';
export const ACCOUNTS = {
  admin: process.env.E2E_ADMIN_PHONE ?? '07000000001',
  staff: process.env.E2E_STAFF_PHONE ?? '07000000002',
  driver: process.env.E2E_DRIVER_PHONE ?? '07000000011',
  customer: process.env.E2E_CUSTOMER_PHONE ?? '07000000101',
} as const;
