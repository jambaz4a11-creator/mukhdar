'use client';
// صفحة المنتجات والأقسام (أدمن، SPEC-admin §2.2، تصميم "Products"): تنبيه بلا سعر شراء/رصيد قليل، بحث
// وفلتر قسم، جدول بالأسعار والكلفة والرصيد بالكيلو (§2.9)، تعديل سريع للسعر، تعطيل، ترتيب، وبطاقات الأقسام.
import { adminUnitLabel, errorMessage, formatAdminQuantity, toAdminPrice } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import {
  catalogKeys,
  fetchCategories,
  fetchProducts,
  isLow,
  reorderCategories,
  reorderProducts,
  saveProduct,
  setProductPrice,
  type Category,
  type Product,
} from './api';
import { CategoryDialog } from './CategoryDialog';
import { formatAdminPrice, marginPercent, parseAdminPrice } from './forms';
import { publicImageUrl } from './image';
import { ProductDialog } from './ProductDialog';
import { PurchaseDialog } from './StockDialogs';
import { MoveButtons, inputClass, moveItem, useDragOrder } from './ui';

type DialogState =
  | { kind: 'product'; product: Product | null }
  | { kind: 'category'; category: Category | null }
  | { kind: 'purchase' }
  | null;

export function ProductsScreen() {
  const { supabase, role } = usePanel();
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: catalogKeys.categories,
    queryFn: () => fetchCategories(supabase),
  });
  const products = useQuery({
    queryKey: catalogKeys.products(role),
    queryFn: () => fetchProducts(supabase, role),
  });
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const cats = useMemo(() => categories.data ?? [], [categories.data]);
  const all = useMemo(() => products.data ?? [], [products.data]);
  const catName = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]);
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of all) m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1);
    return m;
  }, [all]);

  const visible = useMemo(() => {
    const q = search.trim();
    return all
      .filter(
        (p) => (categoryId === null || p.category_id === categoryId) && (!q || p.name.includes(q)),
      )
      .sort((a, b) =>
        categoryId === null
          ? cats.findIndex((c) => c.id === a.category_id) -
              cats.findIndex((c) => c.id === b.category_id) || a.sort_order - b.sort_order
          : a.sort_order - b.sort_order,
      );
  }, [all, cats, search, categoryId]);

  const noCost = all.filter((p) => p.is_active && p.cost_iqd === null).length;
  const low = all.filter((p) => p.is_active && isLow(p)).length;

  const refresh = () => qc.invalidateQueries({ queryKey: catalogKeys.all });
  const onError = (e: unknown) => setActionError(errorMessage(e));

  const toggleActive = useMutation({
    mutationFn: (p: Product) => saveProduct(supabase, { id: p.id, is_active: !p.is_active }),
    onSuccess: refresh,
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderProducts(supabase, ids),
    onSuccess: refresh,
    onError,
  });
  const reorderCats = useMutation({
    mutationFn: (next: Category[]) => reorderCategories(supabase, next),
    onSuccess: refresh,
    onError,
  });

  // الترتيب داخل قسم واحد (بلا بحث): sort_order للزبون داخل القسم
  const canReorder = categoryId !== null && !search.trim();
  const moveProduct = (from: number, to: number) => {
    reorder.mutate(moveItem(visible, from, to).map((p) => p.id));
  };
  const dragProduct = useDragOrder(visible, (next) => reorder.mutate(next.map((p) => p.id)));
  const dragCategory = useDragOrder(cats, (next) => reorderCats.mutate(next));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold">المنتجات والمخزون</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/stock"
            className="flex h-11 items-center rounded-control border border-border bg-surface px-4 text-sm text-text no-underline"
          >
            المخزون والحركات
          </Link>
          <button
            type="button"
            onClick={() => setDialog({ kind: 'purchase' })}
            className="h-11 rounded-control border border-border bg-surface px-4 text-sm"
          >
            إضافة مشتريات
          </button>
          <button
            type="button"
            onClick={() => setDialog({ kind: 'product', product: null })}
            className="h-11 rounded-control bg-primary px-4 text-sm font-bold text-white"
          >
            + منتج جديد
          </button>
        </div>
      </header>

      {(noCost > 0 || low > 0) && (
        <div
          role="status"
          data-testid="catalog-alert"
          className="rounded-control bg-warning-soft px-4 py-3 text-sm text-warning-text"
        >
          {noCost > 0 && <span>{noCost} منتج بدون سعر شراء، أرباحهم تنحسب غلط. </span>}
          {low > 0 && <span>{low} منتج رصيده تحت حد النقص.</span>}
        </div>
      )}
      {actionError && (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="بحث باسم المنتج"
          placeholder="ابحث باسم المنتج"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} max-w-sm flex-1`}
        />
        <select
          aria-label="القسم"
          value={categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
          className={`${inputClass} w-auto`}
        >
          <option value="">كل الأقسام</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <section
        aria-label="جدول المنتجات"
        className="overflow-x-auto rounded-card border border-border bg-surface"
      >
        <table
          className="w-full min-w-[960px] border-collapse text-sm"
          data-testid="products-table"
        >
          <thead>
            <tr className="bg-background text-right text-text-muted">
              <th scope="col" className="px-3 py-3 font-semibold">
                ترتيب
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                المنتج
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                القسم
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                يُباع للزبون
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                سعر البيع
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                سعر الشراء
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                الهامش
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                الرصيد
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                حد النقص
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                نشط
              </th>
            </tr>
          </thead>
          <tbody>
            {products.isPending && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-text-muted">
                  جارٍ التحميل…
                </td>
              </tr>
            )}
            {visible.map((p, i) => (
              <tr
                key={p.id}
                data-product={p.name}
                className={`border-t border-divider ${p.is_active ? '' : 'opacity-60'}`}
                {...(canReorder ? dragProduct(i) : {})}
              >
                <td className="px-3 py-2">
                  {canReorder ? (
                    <MoveButtons
                      label={p.name}
                      index={i}
                      count={visible.length}
                      onMove={(to) => moveProduct(i, to)}
                      disabled={reorder.isPending}
                    />
                  ) : (
                    <span className="num text-text-muted">{p.sort_order}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: 'product', product: p })}
                    className="flex items-center gap-2 text-right"
                    aria-label={`تعديل ${p.name}`}
                  >
                    <Thumb url={publicImageUrl(supabase, p.image_path)} />
                    <span className="font-semibold">{p.name}</span>
                  </button>
                </td>
                <td className="px-3 text-text-muted">{catName.get(p.category_id) ?? '—'}</td>
                <td className="whitespace-nowrap px-3 text-text-muted">{p.unit}</td>
                <td className="whitespace-nowrap px-3">
                  <QuickPrice product={p} onError={onError} onDone={refresh} />
                </td>
                <td
                  className={`num whitespace-nowrap px-3 ${p.cost_iqd === null ? 'text-danger' : ''}`}
                  data-testid="product-cost"
                >
                  {p.cost_iqd === null ? 'غير محدد' : formatAdminPrice(p.cost_iqd, p.unit)}
                </td>
                <td className="num px-3 font-semibold text-primary">
                  {(() => {
                    const m = marginPercent(p.price_iqd, p.cost_iqd);
                    return m === null ? '—' : `${m}%`;
                  })()}
                </td>
                <td
                  className={`num whitespace-nowrap px-3 font-semibold ${
                    p.qty === 0 ? 'text-danger' : isLow(p) ? 'text-warning-text' : ''
                  }`}
                  data-testid="product-stock"
                >
                  {p.qty === 0 ? 'نفد' : formatAdminQuantity(p.qty, p.unit)}
                  {p.qty > 0 && isLow(p) ? ' (قليل)' : ''}
                </td>
                <td className="num whitespace-nowrap px-3 text-text-muted">
                  {formatAdminQuantity(p.low_stock_threshold, p.unit)}
                </td>
                <td className="px-3">
                  <label className="flex min-h-11 items-center">
                    <span className="sr-only">نشط: {p.name}</span>
                    <input
                      type="checkbox"
                      checked={p.is_active}
                      disabled={toggleActive.isPending}
                      onChange={() => toggleActive.mutate(p)}
                      className="h-5 w-5 accent-primary"
                    />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="m-0 text-[13px] text-text-muted">
        داخل اللوحة الكميات والأسعار بالكيلو، والتطبيق يحوّلها للزبون بالنص كيلو تلقائياً. سعر
        الكيلو لازم يكون من مضاعفات 500 (حتى نص الكيلو يطلع من مضاعفات 250).
        {!canReorder &&
          ' لتغيير ترتيب المنتجات اختر قسماً (بلا بحث) ثم اسحب الصفوف أو استعمل الأسهم.'}
      </p>

      <section
        aria-label="الأقسام"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-[17px] font-bold">الأقسام</h2>
          <button
            type="button"
            onClick={() => setDialog({ kind: 'category', category: null })}
            className="h-10 rounded-control bg-primary-soft px-4 text-sm font-semibold text-primary"
          >
            + قسم جديد
          </button>
        </div>
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3"
          data-testid="category-cards"
        >
          {cats.map((c, i) => (
            <div
              key={c.id}
              data-category={c.name}
              className={`flex flex-col overflow-hidden rounded-[14px] border border-border ${c.is_active ? '' : 'opacity-60'}`}
              {...dragCategory(i)}
            >
              <div className="flex h-[88px] items-center justify-center bg-background text-2xl font-bold text-text-muted">
                {c.image_path ? (
                  <img
                    src={publicImageUrl(supabase, c.image_path) ?? ''}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (c.name.trim()[0] ?? '؟')
                )}
              </div>
              <div className="flex items-center justify-between gap-1 p-2">
                <span className="flex flex-col">
                  <span className="text-[15px] font-bold">{c.name}</span>
                  <span className="text-xs text-text-muted">
                    {counts.get(c.id) ?? 0} منتج{c.is_active ? '' : ' · مخفي'}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`تعديل قسم ${c.name}`}
                  onClick={() => setDialog({ kind: 'category', category: c })}
                  className="h-10 w-10 shrink-0 rounded-[10px] border border-border"
                >
                  ✎
                </button>
              </div>
              <div className="flex justify-center pb-2">
                <MoveButtons
                  label={`قسم ${c.name}`}
                  index={i}
                  count={cats.length}
                  onMove={(to) => reorderCats.mutate(moveItem(cats, i, to))}
                  disabled={reorderCats.isPending}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDialog({ kind: 'category', category: null })}
            className="flex min-h-[140px] flex-col items-center justify-center gap-1 rounded-[14px] border border-dashed border-primary/40 bg-surface text-sm font-semibold text-primary"
          >
            قسم جديد مع صورة
          </button>
        </div>
      </section>

      {dialog?.kind === 'product' && (
        <ProductDialog
          product={dialog.product}
          categories={cats}
          defaultCategoryId={categoryId ?? undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'category' && (
        <CategoryDialog
          category={dialog.category}
          nextSortOrder={cats.length + 1}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'purchase' && (
        <PurchaseDialog products={all.filter((p) => p.is_active)} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-background">
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </span>
  );
}

/** تعديل سريع لسعر البيع من الجدول (للكيلو لنص الكيلو) ← set_product_price. */
function QuickPrice({
  product,
  onError,
  onDone,
}: {
  product: Product;
  onError: (e: unknown) => void;
  onDone: () => void;
}) {
  const { supabase } = usePanel();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (price: number) => setProductPrice(supabase, product.id, price),
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
    onError,
  });
  if (!editing) {
    return (
      <span className="flex items-center gap-2">
        <span className="num font-semibold" data-testid="product-price">
          {formatAdminPrice(product.price_iqd, product.unit)}
        </span>
        <button
          type="button"
          aria-label={`تعديل سعر ${product.name}`}
          onClick={() => {
            setValue(String(toAdminPrice(product.price_iqd, product.unit)));
            setError(null);
            setEditing(true);
          }}
          className="h-8 rounded-md border border-border px-2 text-xs"
        >
          تعديل
        </button>
      </span>
    );
  }
  const submit = () => {
    const p = parseAdminPrice(value, product.unit);
    if ('error' in p) setError(p.error);
    else save.mutate(p.value);
  };
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1">
        <input
          aria-label={`السعر الجديد لـ ${product.name}`}
          className="num h-9 w-24 rounded-md border border-border px-2"
          inputMode="numeric"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={save.isPending}
          className="h-9 rounded-md bg-primary px-2 text-xs font-bold text-white"
        >
          حفظ
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="h-9 rounded-md border border-border px-2 text-xs"
        >
          إلغاء
        </button>
      </span>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
      <span className="text-[11px] text-text-muted">د.ع / {adminUnitLabel(product.unit)}</span>
    </span>
  );
}
