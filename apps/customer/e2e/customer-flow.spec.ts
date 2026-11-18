// المسار الكامل للزبون على PWA (بلاغ iOS Safari 2026-11-18: الاسم والعنوان فشلا بعد التسجيل):
// تسجيل ← الاسم ← أول عنوان ← تصفح وإضافة للسلة ← تأكيد الطلب ← إلغاؤه (يرجع المخزون) ← الاسم بحسابي ← حذف الحساب.
// يعمل على WebKit (آيفون) وChromium (أندرويد)، ضد النسخة المنشورة أو dist محلياً، وكلاهما على mukhdar-dev.
import { expect, test, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { validatePin } from '@mukhdar/shared';
import { E2E_PHONE_PREFIX, assertDev } from './env';

const NAME = 'زبون تجربة';
/** E2E_SHOTS=<مجلد>: لقطات شاشة بعرض 360 (أصغر هاتف مدعوم) لمراجعة التصميم بالعين. */
const SHOTS = process.env.E2E_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS)
    await page.screenshot({
      path: `${SHOTS}/${test.info().project.name}-${name}.png`,
      fullPage: true,
    });
}

function newCredentials() {
  const phone = `${E2E_PHONE_PREFIX}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  const randomPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
  let pin = randomPin();
  while (validatePin(pin, phone) !== null) pin = randomPin();
  return { phone, local: `0${phone.slice(3)}`, pin };
}

/** رسالة خطأ ظاهرة (FormMessage) بنص عربي: تُطبع بالفشل بدل انتظار المهلة. */
async function expectNoError(page: Page) {
  await expect(page.getByText(/حدث خطأ غير متوقع|ما عنده صلاحية|تعذّر/)).toHaveCount(0);
}

test('customer: sign up → name → address → order → cancel → delete account', async ({ page }) => {
  assertDev();
  page.on('dialog', (d) => void d.accept()); // Alert على الويب = window.alert/confirm (webShims.web.ts)
  const c = newCredentials();
  if (SHOTS) await page.setViewportSize({ width: 360, height: 780 });

  await test.step('sign up', async () => {
    await page.goto('/auth/sign-up');
    await page.getByTestId('phone-input').fill(c.local);
    await page.getByTestId('pin-input').fill(c.pin);
    await page.getByTestId('pin-confirm-input').fill(c.pin);
    await page.getByTestId('sign-up-submit').click();
    await expect(page.getByTestId('name-input')).toBeVisible({ timeout: 30_000 });
  });

  await test.step('name (the reported bug)', async () => {
    await page.getByTestId('name-input').fill(NAME);
    await page.getByTestId('name-submit').click();
    await expect(page.getByTestId('block-select')).toBeVisible({ timeout: 30_000 });
    await expectNoError(page);
  });

  await test.step('first address: block → building → floor → apartment (+ label)', async () => {
    await page.getByTestId('block-select').click();
    await shot(page, 'address-blocks');
    await page.getByTestId('block-list').getByRole('button', { name: 'A1', exact: true }).click();
    await expect(page.getByTestId('block-value')).toHaveText(/^A1$/);
    await page.getByTestId('building-input').fill('1');
    await expect(page.getByTestId('building-found')).toBeVisible();
    await page.getByTestId('floor-input').fill('3');
    await page.getByTestId('apartment-input').fill('12');
    await page.getByTestId('label-input').fill('البيت');
    await expect(page.getByTestId('address-preview')).toContainText('بناية 1 · الطابق 3 · شقة 12');
    await shot(page, 'address-form');
    await page.getByTestId('address-save').click();
    await expect(page.getByTestId('delivery-address')).toBeVisible({ timeout: 30_000 });
    await expectNoError(page);
  });

  await test.step('browse and add to cart', async () => {
    await expect(page.getByRole('button', { name: /^أضف .+ للسلة$/ }).first()).toBeVisible();
    await shot(page, 'home');
    await page
      .getByRole('button', { name: /^أضف .+ للسلة$/ })
      .first()
      .click();
    await expect(page.getByTestId('cart-bar')).toBeVisible();
    await page.getByTestId('cart-bar').click();
    await expect(page.getByTestId('cart-total')).toBeVisible();
    await page.getByTestId('cart-continue').click();
  });

  await test.step('checkout', async () => {
    await expect(page.getByTestId('checkout-total')).toBeVisible();
    await page.getByTestId('checkout-confirm').click();
    await expect(page.getByTestId('order-hero')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('order-address')).toContainText('بناية 1 · الطابق 3 · شقة 12');
  });

  await test.step('cancel the pending order (stock returns)', async () => {
    await page.getByTestId('order-cancel').click();
    await expect(page.getByText('أُلغي الطلب').first()).toBeVisible({ timeout: 30_000 });
  });

  await test.step('account shows the saved name', async () => {
    await page.goto('/account');
    await expect(page.getByTestId('account-name')).toHaveText(NAME, { timeout: 30_000 });
  });

  await test.step('delete account', async () => {
    await page.getByTestId('delete-account').click();
    await expect(page.getByTestId('delete-account')).toHaveCount(0, { timeout: 30_000 });
    await expectNoError(page);
  });
});
