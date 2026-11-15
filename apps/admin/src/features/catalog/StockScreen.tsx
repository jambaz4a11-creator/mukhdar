'use client';
// المخزون (SPEC-admin §2.3): الأرصدة وحد النقص للأدمن والموظف (بالكيلو لنص الكيلو)، تمييز وفلتر "تحت الحد".
// الأدمن فقط: مشتريات، تسوية جرد، تعديل الحد، وسجل الحركات بالكلفة والقيمة. الموظف لا يرى أي مبلغ.
import { formatAdminQuantity, formatIQD } from '@mukhdar/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { formatDateTime } from '@/features/orders/format';
import {
  MOVEMENT_LABELS,
  catalogKeys,
  fetchMovements,
  fetchProducts,
  isLow,
  type MovementFilters,
  type MovementType,
  type Product,
} from './api';
import { formatAdminPrice } from './forms';
import { AdjustDialog, PurchaseDialog, ThresholdDialog } from './StockDialogs';
import { inputClass } from './ui';

type Dialog =
  | { kind: 'purchase'; productId?: string | undefined }
  | { kind: 'adjust'; product: Product }
  | { kind: 'threshold'; product: Product }
  | null;

export function StockScreen() {
  const { supabase, role } = usePanel();
  const isAdmin = role === 'admin';
  const products = useQuery({
    queryKey: catalogKeys.products(role),
    queryFn: () => fetchProducts(supabase, role),
  });
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const all = useMemo(() => (products.data ?? []).filter((p) => p.is_active), [products.data]);
  const lowCount = all.filter(isLow).length;
  const rows = useMemo(() => {
    const q = search.trim();
    return all
      .filter((p) => (!lowOnly || isLow(p)) && (!q || p.name.includes(q)))
      .sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || a.name.localeCompare(b.name, 'ar'));
  }, [all, search, lowOnly]);
  const historyProduct = historyId ? all.find((p) => p.id === historyId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold">المخزون</h1>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setDialog({ kind: 'purchase' })}
            className="h-11 rounded-control bg-primary px-4 text-sm font-bold text-white"
          >
            إضافة مشتريات
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="بحث باسم المنتج"
          placeholder="ابحث باسم المنتج"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} max-w-sm flex-1`}
        />
        <label className="flex h-11 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
            className="h-5 w-5 accent-primary"
          />
          تحت الحد فقط
          <span
            className="num rounded-full bg-warning-soft px-2 text-xs text-warning-text"
            data-testid="low-count"
          >
            {lowCount}
          </span>
        </label>
      </div>

      <section
        aria-label="أرصدة المخزون"
        className="overflow-x-auto rounded-card border border-border bg-surface"
      >
        <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="stock-table">
          <thead>
            <tr className="bg-background text-right text-text-muted">
              <th scope="col" className="px-3 py-3 font-semibold">
                المنتج
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                الرصيد الحالي
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                حد النقص
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                آخر حركة
              </th>
              {isAdmin && (
                <th scope="col" className="px-3 py-3 font-semibold">
                  إجراءات
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {products.isPending && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  جارٍ التحميل…
                </td>
              </tr>
            )}
            {rows.map((p) => (
              <tr
                key={p.id}
                data-product={p.name}
                data-low={isLow(p) ? 'true' : undefined}
                className={`border-t border-divider ${isLow(p) ? 'bg-warning-soft/60' : ''}`}
              >
                <td className="px-3 py-2 font-semibold">{p.name}</td>
                <td
                  className={`num whitespace-nowrap px-3 font-semibold ${isLow(p) ? 'text-warning-text' : ''}`}
                  data-testid="stock-qty"
                >
                  {formatAdminQuantity(p.qty, p.unit)}
                  {isLow(p) && <span className="mr-1 text-xs font-normal">(تحت الحد)</span>}
                </td>
                <td className="num whitespace-nowrap px-3 text-text-muted">
                  {formatAdminQuantity(p.low_stock_threshold, p.unit)}
                </td>
                <td className="num whitespace-nowrap px-3 text-text-muted">
                  {p.stock_updated_at ? formatDateTime(p.stock_updated_at) : '—'}
                </td>
                {isAdmin && (
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      <RowButton
                        label="مشتريات"
                        name={p.name}
                        onClick={() => setDialog({ kind: 'purchase', productId: p.id })}
                      />
                      <RowButton
                        label="تسوية"
                        name={p.name}
                        onClick={() => setDialog({ kind: 'adjust', product: p })}
                      />
                      <RowButton
                        label="الحد"
                        name={p.name}
                        onClick={() => setDialog({ kind: 'threshold', product: p })}
                      />
                      <RowButton label="الحركات" name={p.name} onClick={() => setHistoryId(p.id)} />
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isAdmin && historyProduct && (
        <MovementsPanel product={historyProduct} onClose={() => setHistoryId(null)} />
      )}

      {dialog?.kind === 'purchase' && (
        <PurchaseDialog
          products={all}
          initialProductId={dialog.productId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'adjust' && (
        <AdjustDialog product={dialog.product} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'threshold' && (
        <ThresholdDialog product={dialog.product} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function RowButton({ label, name, onClick }: { label: string; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${label}: ${name}`}
      onClick={onClick}
      className="h-9 rounded-md border border-border px-2 text-xs"
    >
      {label}
    </button>
  );
}

const TYPES: MovementType[] = ['purchase', 'sale', 'waste', 'adjust', 'cancel_return'];

/** سجل حركات منتج (أدمن): صفحات 50، فلترة بالنوع والتاريخ، الكمية والكلفة بالكيلو أو بالوحدة. */
function MovementsPanel({ product, onClose }: { product: Product; onClose: () => void }) {
  const { supabase } = usePanel();
  const [filters, setFilters] = useState<MovementFilters>({ type: null, from: null, to: null });
  const list = useInfiniteQuery({
    queryKey: catalogKeys.movements(product.id, filters),
    queryFn: ({ pageParam }) => fetchMovements(supabase, product.id, filters, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next,
  });
  const rows = (list.data?.pages ?? []).flatMap((p) => p.rows);
  return (
    <section
      aria-label={`حركات ${product.name}`}
      data-testid="movements"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[17px] font-bold">حركات {product.name}</h2>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-control border border-border px-3 text-sm"
        >
          إغلاق
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="نوع الحركة"
          className={`${inputClass} w-auto`}
          value={filters.type ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, type: (e.target.value || null) as MovementType | null }))
          }
        >
          <option value="">كل الأنواع</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_LABELS[t]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          من
          <input
            type="date"
            className={`${inputClass} w-auto`}
            value={filters.from ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || null }))}
          />
        </label>
        <label className="flex items-center gap-1 text-sm">
          إلى
          <input
            type="date"
            className={`${inputClass} w-auto`}
            value={filters.to ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || null }))}
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-background text-right text-text-muted">
              <th scope="col" className="px-3 py-2 font-semibold">
                الوقت
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                النوع
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                الكمية
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                الكلفة
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                القيمة
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                المستخدم
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                الملاحظة
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-divider" data-movement={m.type}>
                <td className="num whitespace-nowrap px-3 py-2">{formatDateTime(m.created_at)}</td>
                <td className="px-3">{MOVEMENT_LABELS[m.type]}</td>
                <td
                  className={`num whitespace-nowrap px-3 ${m.qty < 0 ? 'text-danger' : 'text-primary'}`}
                >
                  {m.qty > 0 ? '+' : ''}
                  {formatAdminQuantity(m.qty, product.unit)}
                </td>
                <td className="num whitespace-nowrap px-3">
                  {formatAdminPrice(m.unit_cost_iqd, product.unit)}
                </td>
                <td className="num whitespace-nowrap px-3">
                  {formatIQD(Math.abs(m.qty) * m.unit_cost_iqd)}
                </td>
                <td className="px-3 text-text-muted">{m.by ?? (m.order_id ? 'طلب' : '—')}</td>
                <td className="px-3 text-text-muted">{m.note ?? ''}</td>
              </tr>
            ))}
            {!list.isPending && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-text-muted">
                  لا حركات
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {list.hasNextPage && (
        <button
          type="button"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
          className="h-10 self-center rounded-control border border-border px-4 text-sm"
        >
          عرض المزيد
        </button>
      )}
    </section>
  );
}
