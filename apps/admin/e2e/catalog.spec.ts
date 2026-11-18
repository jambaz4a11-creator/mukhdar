import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS } from './accounts';
import { pageAs } from './helpers';
import { ALLOW_WRITES, anonClient, signedInClient } from './supabase';

// T18: المنتجات والأقسام والمخزون وهدر اليوم. القراءة تعمل على أي بيانات seed (محلياً ضد mukhdar-dev)؛
// الكتابة (أقسام، منتجات، صور، مشتريات، هدر) فقط مع E2E_ALLOW_WRITES=1 (CI، Supabase محلي مع Storage).

/** صورة "من الهاتف" (~5MB PNG ضوضاء، أسوأ حالة للضغط) تُولَّد بالمتصفح. */
async function phonePhoto(page: Page, width = 1400, height = 1000): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([w, h]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < img.data.length; i++) img.data[i] = (Math.random() * 256) | 0;
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise<Blob>((r, j) =>
        c.toBlob((b) => (b ? r(b) : j(new Error('toBlob'))), 'image/png'),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [width, height] as const,
  );
  return Buffer.from(b64, 'base64');
}

async function openProducts(page: Page) {
  await page.goto('/products');
  await expect(page.getByRole('heading', { level: 1, name: 'المنتجات والمخزون' })).toBeVisible();
  await expect(
    page.getByTestId('products-table').locator('tbody tr[data-product]').first(),
  ).toBeVisible();
}

test.describe.serial('catalog (admin, read)', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
  });
  test.afterAll(async () => page.context().close());

  test('products table in kilos and per-kilo prices, with category cards', async () => {
    await openProducts(page);
    const prices = page.getByTestId('product-price');
    await expect(prices.filter({ hasText: '/ كيلو' }).first()).toBeVisible();
    await expect(
      page.getByTestId('product-stock').filter({ hasText: 'كيلو' }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId('category-cards').locator('[data-category]').first(),
    ).toBeVisible();
  });

  test('daily waste: cost before saving, invalid kilo steps block saving', async () => {
    await page.goto('/waste');
    await expect(page.getByRole('heading', { level: 1, name: 'هدر اليوم' })).toBeVisible();
    // الهدر لليوم فقط: تسمية "اليوم" بتاريخ بغداد، بلا حقل تاريخ قابل للتغيير
    const baghdadDay = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    await expect(page.getByTestId('waste-day')).toContainText('اليوم');
    await expect(page.getByTestId('waste-day')).toContainText(baghdadDay);
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    const rows = page.getByTestId('waste-table').locator('tbody tr[data-product]');
    await expect(rows.first()).toBeVisible();
    // أول منتج بالكيلو له رصيد (عمود الرصيد ليس "0 كيلو")
    const kiloRows = rows.filter({ hasText: 'بالكيلو' });
    let row = kiloRows.first();
    for (let i = 0; i < (await kiloRows.count()); i++) {
      const stock = (await kiloRows.nth(i).locator('td').nth(1).innerText()).trim();
      if (stock !== '0 كيلو') {
        row = kiloRows.nth(i);
        break;
      }
    }
    const input = row.getByRole('textbox');
    await input.fill('0.5');
    await expect(page.getByTestId('waste-count')).toContainText('1 منتج');
    const save = page.getByRole('button', { name: 'حفظ الهدر' });
    await expect(save).toBeEnabled();
    await input.fill('0.3');
    await expect(row.getByRole('alert')).toContainText('0.5');
    await expect(save).toBeDisabled();
    await input.fill('');
    await expect(page.getByTestId('waste-total')).toHaveText('0 د.ع');
  });
});

test('staff: sees stock balances, no movement buttons and no amounts', async ({ browser }) => {
  const page = await pageAs(browser, 'staff');
  await page.goto('/stock');
  await expect(page.getByRole('heading', { level: 1, name: 'المخزون' })).toBeVisible();
  const table = page.getByTestId('stock-table');
  await expect(table.locator('tbody tr[data-product]').first()).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'إجراءات' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'إضافة مشتريات' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^مشتريات:/ })).toHaveCount(0);
  await expect(table).not.toContainText('د.ع');
  // فلتر "تحت الحد"
  await page.getByLabel('تحت الحد فقط').check();
  const rows = table.locator('tbody tr[data-product]');
  const n = await rows.count();
  for (let i = 0; i < n; i++) await expect(rows.nth(i)).toHaveAttribute('data-low', 'true');
  await page.context().close();
});

test.describe.serial('catalog (writes: categories, products, images, stock, waste)', () => {
  test.skip(!ALLOW_WRITES, 'writes only against a local Supabase (E2E_ALLOW_WRITES=1)');
  let page: Page;
  const tag = String(Date.now() % 100000);
  const categoryName = `قسم اختبار ${tag}`;
  const productName = `طماطة اختبار ${tag}`;

  test.beforeAll(async ({ browser }) => {
    page = await pageAs(browser, 'admin');
  });
  test.afterAll(async () => page.context().close());

  test('new category with an image appears in the cards; hiding it hides it from the customer app', async () => {
    await openProducts(page);
    await page.getByRole('button', { name: '+ قسم جديد' }).click();
    const dialog = page.getByTestId('category-dialog');
    await dialog.getByLabel('اسم القسم').fill(categoryName);
    await dialog.getByLabel('صورة القسم').setInputFiles({
      name: 'cat.png',
      mimeType: 'image/png',
      buffer: await phonePhoto(page, 900, 700),
    });
    const size = dialog.getByTestId('c-image-size');
    await expect(size).toBeVisible({ timeout: 15_000 });
    expect(Number(await size.getAttribute('data-bytes'))).toBeLessThanOrEqual(100 * 1024);
    await dialog.getByRole('button', { name: 'حفظ القسم' }).click();
    await expect(dialog).toBeHidden();
    const card = page.locator(`[data-category="${categoryName}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('img')).toHaveAttribute('src', /\/categories\/\d+\/\d+\.webp$/);

    const anon = anonClient();
    const visible = await anon.from('categories').select('id').eq('name', categoryName);
    expect(visible.data).toHaveLength(1);

    await card.getByRole('button', { name: `تعديل قسم ${categoryName}` }).click();
    await page
      .getByTestId('category-dialog')
      .getByLabel(/ظاهر للزبون/)
      .uncheck();
    await page.getByTestId('category-dialog').getByRole('button', { name: 'حفظ القسم' }).click();
    await expect(card).toContainText('مخفي');
    const hidden = await anon.from('categories').select('id').eq('name', categoryName);
    expect(hidden.data).toHaveLength(0);
  });

  test('categories: duplicate name refused, rename, reorder, delete only when empty, audited', async () => {
    await openProducts(page);
    const renamed = `${categoryName} معدّل`;
    const card = page.locator(`[data-category="${categoryName}"]`);
    await card.getByRole('button', { name: `تعديل قسم ${categoryName}` }).click();
    const dialog = page.getByTestId('category-dialog');
    // اسم قسم موجود ← رفض بالقاعدة برسالة عربية
    const existing = await page.locator('[data-category]').first().getAttribute('data-category');
    await dialog.getByLabel('اسم القسم').fill(existing ?? '');
    await dialog.getByRole('button', { name: 'حفظ القسم' }).click();
    await expect(dialog.getByRole('alert')).toContainText('يوجد قسم بنفس الاسم');
    await dialog.getByLabel('اسم القسم').fill(renamed);
    await dialog.getByRole('button', { name: 'حفظ القسم' }).click();
    await expect(dialog).toBeHidden();
    const renamedCard = page.locator(`[data-category="${renamed}"]`);
    await expect(renamedCard).toBeVisible();

    // الترتيب: تقديم القسم خطوة (استدعاء ذرّي واحد)
    const order = async () =>
      page
        .locator('[data-testid="category-cards"] [data-category]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-category')));
    const before = await order();
    const idx = before.indexOf(renamed);
    await renamedCard.getByRole('button', { name: `تقديم قسم ${renamed}` }).click();
    await expect
      .poll(order)
      .toEqual(before.map((_, i, a) => (i === idx - 1 ? a[idx] : i === idx ? a[idx - 1] : a[i])));

    // قسم فيه منتجات لا يُحذف (يُخفى بدل ذلك)
    const withProducts = page
      .locator('[data-category]')
      .filter({ hasText: /[1-9]\d* منتج/ })
      .first();
    const withName = await withProducts.getAttribute('data-category');
    await withProducts.getByRole('button', { name: `تعديل قسم ${withName}` }).click();
    await expect(page.getByTestId('category-delete-blocked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'حذف القسم' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // القسم الفارغ يُحذف بعد تأكيد
    await renamedCard.getByRole('button', { name: `تعديل قسم ${renamed}` }).click();
    await page.getByRole('button', { name: 'حذف القسم' }).click();
    await page.getByRole('button', { name: 'تأكيد الحذف' }).click();
    await expect(renamedCard).toHaveCount(0);

    // تدقيق: إنشاء، تعديل، ترتيب، حذف
    const admin = await signedInClient(ACCOUNTS.admin);
    const audit = await admin.from('admin_audit').select('before, after').eq('action', 'category');
    const ops = (audit.data ?? []).map((r) => (r.after?.op ?? r.before?.op) as string);
    for (const op of ['create', 'update', 'reorder', 'delete']) expect(ops).toContain(op);
  });

  test('create a half-kilo product with a 5MB photo: price per kilo saved per half kilo', async () => {
    await openProducts(page);
    await page.getByRole('button', { name: '+ منتج جديد' }).click();
    const dialog = page.getByTestId('product-dialog');
    await dialog.getByLabel('اسم المنتج').fill(productName);
    await dialog.getByLabel('وحدة البيع للزبون').selectOption('نص كيلو');
    await dialog.getByLabel('السعر / كيلو').fill('1250');
    await dialog.getByRole('button', { name: 'حفظ المنتج' }).click();
    await expect(dialog.getByTestId('error-p-price')).toContainText('500'); // سعر كيلو 1250 مرفوض
    await dialog.getByLabel('السعر / كيلو').fill('3000');

    const photo = await phonePhoto(page);
    expect(photo.length).toBeGreaterThan(4 * 1024 * 1024);
    await dialog
      .getByLabel('صورة المنتج')
      .setInputFiles({ name: 'phone.png', mimeType: 'image/png', buffer: photo });
    const size = dialog.getByTestId('p-image-size');
    await expect(size).toBeVisible({ timeout: 20_000 });
    expect(Number(await size.getAttribute('data-bytes'))).toBeLessThan(200 * 1024);
    await dialog.getByRole('button', { name: 'حفظ المنتج' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const row = page.locator(`tr[data-product="${productName}"]`);
    await expect(row.getByTestId('product-price')).toHaveText('3,000 د.ع / كيلو');

    const admin = await signedInClient(ACCOUNTS.admin);
    const { data } = await admin
      .from('products')
      .select('price_iqd, unit, image_path')
      .eq('name', productName)
      .single();
    expect(data).toMatchObject({ price_iqd: 1500, unit: 'نص كيلو' });
    const path = (data as { image_path: string }).image_path;
    expect(path).toMatch(/^[0-9a-f-]{36}\/\d+\.webp$/);
    const file = await admin.storage.from('product-images').download(path);
    expect(file.error).toBeNull();
    expect(file.data?.size ?? Infinity).toBeLessThan(200 * 1024);
  });

  test('quick price edit in kilos', async () => {
    const row = page.locator(`tr[data-product="${productName}"]`);
    await row.getByRole('button', { name: `تعديل سعر ${productName}` }).click();
    const input = row.getByLabel(`السعر الجديد لـ ${productName}`);
    await input.fill('3250');
    await row.getByRole('button', { name: 'حفظ' }).click();
    await expect(row.getByRole('alert')).toContainText('500');
    await input.fill('4000');
    await row.getByRole('button', { name: 'حفظ' }).click();
    await expect(row.getByTestId('product-price')).toHaveText('4,000 د.ع / كيلو');
  });

  test('purchase "2.5 كيلو" at 3000 / كيلو: stock +5 units, in stock, purchase price updated', async () => {
    await page.goto('/stock');
    const row = page.locator(`tr[data-product="${productName}"]`);
    await row.getByRole('button', { name: `مشتريات: ${productName}` }).click();
    const dialog = page.getByTestId('purchase-dialog');
    await dialog.getByLabel('الكمية (كيلو)').fill('2.3');
    await dialog.getByLabel('سعر الشراء / كيلو').fill('3000');
    await dialog.getByRole('button', { name: 'حفظ المشتريات' }).click();
    await expect(dialog.getByTestId('error-pu-qty')).toBeVisible(); // 2.3 كيلو مرفوضة
    await dialog.getByLabel('الكمية (كيلو)').fill('2.5');
    await dialog.getByRole('button', { name: 'حفظ المشتريات' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByTestId('stock-qty')).toContainText('2.5 كيلو');

    const admin = await signedInClient(ACCOUNTS.admin);
    const { data } = await admin
      .from('products')
      .select('id, in_stock, stock(qty), product_costs(cost_iqd)')
      .eq('name', productName)
      .single();
    expect(data).toMatchObject({
      in_stock: true,
      stock: { qty: 5 },
      product_costs: { cost_iqd: 1500 },
    });

    // سجل الحركات: المشتريات بكلفتها للكيلو
    await row.getByRole('button', { name: `الحركات: ${productName}` }).click();
    const log = page.getByTestId('movements');
    await expect(log.locator('tr[data-movement="purchase"]')).toContainText('3,000 د.ع / كيلو');
  });

  test("daily waste saved in one go: stock decreases and today's waste grows", async () => {
    await page.goto('/waste');
    const before = await page.getByTestId('waste-today-saved').innerText();
    const row = page.locator(`tr[data-product="${productName}"]`);
    await row.getByLabel(`الكمية التالفة لـ${productName}`).fill('1');
    await expect(row.getByTestId('waste-line-cost')).toHaveText('3,000 د.ع'); // 2 × 1500
    await expect(page.getByTestId('waste-total')).toHaveText('3,000 د.ع');
    await page.getByRole('button', { name: 'حفظ الهدر' }).click();
    await expect(page.getByTestId('waste-saved')).toContainText('3,000 د.ع');
    await expect(row).toContainText('1.5 كيلو');
    await expect(page.getByTestId('waste-today-saved')).not.toHaveText(before);
  });

  test('deactivating a product hides it from the customer app', async () => {
    await openProducts(page);
    const row = page.locator(`tr[data-product="${productName}"]`);
    const anon = anonClient();
    expect((await anon.from('products').select('id').eq('name', productName)).data).toHaveLength(1);
    // الخانة تعكس حالة قاعدة البيانات: تتغير بعد الحفظ وإعادة الجلب، لا فوراً
    await row.getByLabel(`نشط: ${productName}`).click();
    await expect(row.getByLabel(`نشط: ${productName}`)).not.toBeChecked();
    await expect
      .poll(
        async () => (await anon.from('products').select('id').eq('name', productName)).data?.length,
      )
      .toBe(0);
  });
});
