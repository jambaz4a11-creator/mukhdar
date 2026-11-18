// بطاقة المنتج (تصميم 2026-11-18) على أصغر هاتف مدعوم (360px) بـ WebKit وChromium، بلا حساب (التصفح مسموح للزائر):
// الصورة مربعة بعرض البطاقة وأكبر عنصر فيها، كاملة بلا قص (contain)، الاسم والسعر تحتها والزر بالأسفل،
// بنفس الشكل بالرئيسية وبقسم وبنتائج البحث. E2E_SHOTS=<مجلد> يحفظ لقطات للمراجعة بالعين.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertDev } from './env';

const SHOTS = process.env.E2E_SHOTS;

test.use({ viewport: { width: 360, height: 780 } });

async function shot(page: Page, name: string) {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-cards-${name}.png` });
  }
}

/** يتحقق من أول بطاقتين ظاهرتين: صورة مربعة بعرض البطاقة، فوق الاسم، والزر بالأسفل، والعمودان بالترتيب RTL. */
async function expectCards(page: Page) {
  const cards = page.locator('[data-testid^="product-card-"]');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  const count = Math.min(await cards.count(), 2);
  for (let i = 0; i < count; i++) await expectCard(cards.nth(i));
  if (count === 2) {
    const [a, b] = [await box(cards.nth(0)), await box(cards.nth(1))];
    expect(a.x).toBeGreaterThan(b.x); // RTL: الأولى يميناً
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(a.x + a.width).toBeLessThanOrEqual(360);
    expect(b.x).toBeGreaterThanOrEqual(0);
  }
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

async function expectCard(card: Locator) {
  const id = ((await card.getAttribute('data-testid')) ?? '').replace('product-card-', '');
  const image = card.locator(`[data-testid="product-image-${id}"]`);
  const c = await box(card);
  const img = await box(image);
  expect(c.width).toBeGreaterThan(140); // 360px: (360 - 40 - 12) / 2 = 154
  expect(Math.abs(img.width - (c.width - 2))).toBeLessThanOrEqual(1); // بعرض البطاقة داخل الحد
  expect(Math.abs(img.width - img.height)).toBeLessThanOrEqual(1); // مربعة
  expect(img.height).toBeGreaterThan(c.height / 2); // أكبر عنصر بالبطاقة
  expect(img.y - c.y).toBeLessThanOrEqual(1); // بأعلى البطاقة

  // الاسم تحت الصورة، والزر (أضف أو العداد أو غير متوفر) بأسفل البطاقة
  const name = await box(card.getByText(/\S/).first());
  expect(name.y).toBeGreaterThanOrEqual(img.y + img.height - 1);
  const action = await box(
    card
      .getByRole('button', { name: /^أضف .+ للسلة$|زيادة/ })
      .or(card.getByText('غير متوفر'))
      .first(),
  );
  expect(c.y + c.height - (action.y + action.height)).toBeLessThan(16);

  // صورة حقيقية محمّلة بلا قص، أو بديل محايد
  const photo = image.locator('img');
  if ((await photo.count()) > 0) {
    await expect
      .poll(() =>
        photo.first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
      )
      .toBe(true);
    const fit = await photo.first().evaluate((el) => getComputedStyle(el).objectFit);
    expect(fit).toBe('contain');
  }
}

test('product cards: square full-width image on home, category and search (360px)', async ({
  page,
}) => {
  assertDev();
  await page.goto('/');

  await test.step('home', async () => {
    await expectCards(page);
    await shot(page, 'home');
  });

  await test.step('category', async () => {
    const chips = page.getByRole('button', { name: 'الكل', exact: true }).locator('..');
    const second = chips.getByRole('button').nth(1);
    const category = (await second.innerText()).trim();
    await second.click();
    await expect(page.getByRole('heading', { name: category, exact: true })).toBeVisible();
    await expectCards(page);
    await shot(page, 'category');
  });

  await test.step('search', async () => {
    await page.getByRole('textbox').first().fill('ط');
    await expect(page.getByText('نتائج البحث')).toBeVisible();
    await expectCards(page);
    await shot(page, 'search');
  });

  await test.step('add turns into the half-kilo stepper inside the card', async () => {
    const card = page.locator('[data-testid^="product-card-"]').first();
    const add = card.getByRole('button', { name: /^أضف .+ للسلة$/ });
    if ((await add.count()) === 0) return; // أول نتيجة غير متوفرة
    await add.click();
    const stepper = card.locator('[data-testid^="stepper-"]');
    await expect(stepper).toBeVisible();
    // وحدة واحدة: "نص كيلو" أو "1 باقة"... (النص يشمل رموز أيقونتي + و- فلا مرساة)
    await expect(stepper).toContainText(/نص كيلو|1 \S+/);
    const s = await box(stepper);
    const c = await box(card);
    expect(s.x).toBeGreaterThanOrEqual(c.x);
    expect(s.x + s.width).toBeLessThanOrEqual(c.x + c.width + 0.5);
    await shot(page, 'stepper');
  });
});
