'use client';
// هدر اليوم (أدمن، SPEC-admin §2.3، تصميم "Daily Waste"): كل المنتجات النشطة بحقل كمية (بالكيلو بخطوة 0.5
// أو بالوحدة)، كلفة الهدر قبل الحفظ، وحفظ واحد بمعاملة واحدة (adjust_stock_bulk). الهدر يُسجَّل لليوم
// الحالي (بغداد) فقط: الحركة تأخذ وقت الحفظ، فالتاريخ تسمية "اليوم" للقراءة فقط (لا حقل تاريخ).
import { adminUnitLabel, errorMessage, formatAdminQuantity, formatIQD } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { baghdadToday } from '@/features/orders/filters';
import { adjustStockBulk, catalogKeys, fetchProducts, fetchWasteHistory } from './api';
import { wasteLineCost, wasteSummary, type WasteProduct } from './forms';
import { publicImageUrl } from './image';
import { inputClass } from './ui';

function daysAgo(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { weekday: 'long', timeZone: 'UTC' });

export function WasteScreen() {
  const { supabase, role } = usePanel();
  const qc = useQueryClient();
  const today = baghdadToday();
  const products = useQuery({
    queryKey: catalogKeys.products(role),
    queryFn: () => fetchProducts(supabase, role),
  });
  const history = useQuery({
    queryKey: catalogKeys.wasteHistory,
    queryFn: () => fetchWasteHistory(supabase, daysAgo(today, 7)),
  });
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<{ count: number; cost: number } | null>(null);

  const active = useMemo(
    () =>
      (products.data ?? [])
        .filter((p) => p.is_active)
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    [products.data],
  );
  const wasteRows: WasteProduct[] = useMemo(
    () => active.map((p) => ({ id: p.id, unit: p.unit, qty: p.qty, cost: p.cost_iqd })),
    [active],
  );
  const summary = wasteSummary(wasteRows, entries);
  const hasErrors = Object.keys(summary.errors).length > 0;

  const save = useMutation({
    mutationFn: () => adjustStockBulk(supabase, summary.items, 'waste', note.trim() || 'هدر اليوم'),
    onSuccess: async () => {
      setSaved({ count: summary.count, cost: summary.cost });
      setEntries({});
      setNote('');
      await qc.invalidateQueries({ queryKey: catalogKeys.all });
    },
  });

  const todaySaved = (history.data ?? []).find((h) => h.day === today)?.waste_cost_iqd ?? 0;
  const past = (history.data ?? []).filter((h) => h.day !== today);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-[26px] font-bold">هدر اليوم</h1>
          <span className="text-sm text-text-muted">
            اكتب كمية التالف لكل منتج، وبعدين احفظ مرة وحدة بآخر اليوم
          </span>
        </div>
        <p
          className="m-0 flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm"
          data-testid="waste-day"
        >
          <span className="font-semibold">اليوم</span>
          <span className="text-text-muted">{WEEKDAY.format(new Date(`${today}T12:00:00Z`))}</span>
          <span className="num" dir="ltr">
            {today}
          </span>
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-label="إدخال الهدر"
          className="min-w-0 flex-[999_1_520px] overflow-x-auto rounded-card border border-border bg-surface"
        >
          <table className="w-full min-w-[600px] border-collapse text-sm" data-testid="waste-table">
            <thead>
              <tr className="bg-background text-right text-text-muted">
                <th scope="col" className="px-3 py-3 font-semibold">
                  المنتج
                </th>
                <th scope="col" className="px-3 py-3 font-semibold">
                  الرصيد الحالي
                </th>
                <th scope="col" className="px-3 py-3 font-semibold">
                  الكمية التالفة
                </th>
                <th scope="col" className="px-3 py-3 font-semibold">
                  الكلفة (سعر الشراء)
                </th>
              </tr>
            </thead>
            <tbody>
              {products.isPending && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-muted">
                    جارٍ التحميل…
                  </td>
                </tr>
              )}
              {active.map((p, i) => {
                const raw = entries[p.id] ?? '';
                const row = wasteRows[i];
                const cost = row ? wasteLineCost(row, raw) : null;
                const err = summary.errors[p.id];
                const unitLabel = adminUnitLabel(p.unit);
                return (
                  <tr key={p.id} data-product={p.name} className="border-t border-divider">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-background">
                          {p.image_path && (
                            <img
                              src={publicImageUrl(supabase, p.image_path) ?? ''}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          )}
                        </span>
                        <span className="flex flex-col">
                          <span className="font-semibold">{p.name}</span>
                          <span className="text-xs text-text-muted">الكمية بال{unitLabel}</span>
                        </span>
                      </span>
                    </td>
                    <td className="num whitespace-nowrap px-3 text-text-muted">
                      {formatAdminQuantity(p.qty, p.unit)}
                    </td>
                    <td className="px-3 py-1">
                      <label className="flex items-center gap-1.5">
                        <span className="sr-only">الكمية التالفة لـ{p.name}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={raw}
                          onChange={(e) => setEntries((s) => ({ ...s, [p.id]: e.target.value }))}
                          aria-invalid={err ? 'true' : undefined}
                          className={`num h-10 w-20 rounded-[10px] border bg-surface px-2 text-center text-[15px] ${
                            err ? 'border-danger' : raw.trim() ? 'border-primary' : 'border-border'
                          }`}
                        />
                        <span className="text-[13px] text-text-muted">{unitLabel}</span>
                      </label>
                      {err && (
                        <span role="alert" className="text-xs text-danger">
                          {err}
                        </span>
                      )}
                    </td>
                    <td
                      className={`num px-3 font-semibold ${cost !== null ? 'text-warning-text' : 'text-text-muted'}`}
                      data-testid="waste-line-cost"
                    >
                      {cost !== null
                        ? formatIQD(cost)
                        : raw.trim() && p.cost_iqd === null
                          ? 'بلا سعر شراء'
                          : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <aside aria-label="ملخص الهدر" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
          <div className="flex flex-col gap-2.5 rounded-card border border-border bg-surface p-4">
            <span className="text-sm text-text-muted">مجموع هدر هذا الإدخال</span>
            <span className="num text-[28px] font-bold text-warning-text" data-testid="waste-total">
              {formatIQD(summary.cost)}
            </span>
            <span className="text-[13px]" data-testid="waste-count">
              {summary.count} منتج · ينطرح من صافي الربح
              {summary.missingCost > 0 && ` · ${summary.missingCost} بلا سعر شراء (كلفته صفر)`}
            </span>
            <label htmlFor="waste-note" className="text-[13px] font-semibold">
              ملاحظة (اختيارية)
            </label>
            <input
              id="waste-note"
              className={inputClass}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              disabled={summary.count === 0 || hasErrors || save.isPending}
              onClick={() => save.mutate()}
              className="h-[52px] rounded-control bg-primary text-[15px] font-bold text-white disabled:opacity-50"
            >
              {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الهدر'}
            </button>
            <span className="text-xs text-text-muted">
              ينحفظ كله مرة وحدة، والرصيد ينقص تلقائياً.
            </span>
            {hasErrors && (
              <span role="alert" className="text-xs text-danger">
                صحّح الكميات المعلّمة بالأحمر قبل الحفظ
              </span>
            )}
            {save.error && (
              <p
                role="alert"
                className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                {errorMessage(save.error)}
              </p>
            )}
            {saved && !save.error && (
              <p
                role="status"
                data-testid="waste-saved"
                className="m-0 rounded-control bg-primary-soft px-3 py-2 text-sm text-primary"
              >
                انحفظ هدر {saved.count} منتج بكلفة {formatIQD(saved.cost)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
            <h2 className="m-0 text-[15px] font-bold">آخر 7 أيام</h2>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">اليوم (محفوظ)</span>
              <span className="num" data-testid="waste-today-saved">
                {formatIQD(todaySaved)}
              </span>
            </div>
            {past.map((h) => (
              <div key={h.day} className="flex justify-between text-sm">
                <span className="text-text-muted">
                  {h.day === daysAgo(today, 1)
                    ? 'أمس'
                    : WEEKDAY.format(new Date(`${h.day}T12:00:00Z`))}
                </span>
                <span className="num">{formatIQD(h.waste_cost_iqd)}</span>
              </div>
            ))}
            {past.length === 0 && <span className="text-sm text-text-muted">لا هدر مسجّل</span>}
          </div>
        </aside>
      </div>
    </div>
  );
}
