'use client';
// تبويب "السجل" (SPEC-cash §4، C6/C10): K7، صفحات 50 بـ keyset. الموظف يرى آخر 7 أيام فقط (تفرضه قاعدة البيانات)
// مع ملاحظة. "تصحيح" وعرض المبلغ الأصلي للأدمن فقط. الملاحظات نص صرف (React يهرّب).
import { errorMessage, formatIQD } from '@mukhdar/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { inputClass } from '@/features/catalog/ui';
import { baghdadToday } from '@/features/orders/filters';
import { fetchDrivers } from '@/features/orders/api';
import { formatDateTime } from '@/features/orders/format';
import { cashKeys, fetchHistory, nextCursor, type HandoverRow, type HistoryFilters } from './api';
import { DiffBadge } from './DiffBadge';
import { diffFromSigned } from './difference';
import { STAFF_HISTORY_NOTE, basisLabel } from './text';

export function HistoryTab({ onCorrect }: { onCorrect: (row: HandoverRow) => void }) {
  const { supabase, role } = usePanel();
  const today = baghdadToday();
  const [filters, setFilters] = useState<HistoryFilters>({ driverId: null, from: null, to: null });
  const drivers = useQuery({
    queryKey: ['cash', 'drivers'] as const,
    queryFn: () => fetchDrivers(supabase),
    staleTime: 5 * 60_000,
  });
  const history = useInfiniteQuery({
    queryKey: cashKeys.history(filters),
    queryFn: ({ pageParam }) => fetchHistory(supabase, filters, pageParam),
    initialPageParam: null as { at: string; id: string } | null,
    getNextPageParam: (last) => nextCursor(last) ?? null,
    refetchInterval: 30_000,
  });
  const rows = history.data?.pages.flat() ?? [];
  const set = (patch: Partial<HistoryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="flex flex-col gap-3" data-testid="cash-history">
      {role === 'staff' && (
        <p className="m-0 text-[13px] text-text-muted" data-testid="staff-history-note">
          {STAFF_HISTORY_NOTE}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          السائق
          <select
            className={`${inputClass} min-w-[160px]`}
            value={filters.driverId ?? ''}
            onChange={(e) => set({ driverId: e.target.value || null })}
          >
            <option value="">كل السواق</option>
            {(drivers.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          من
          <input
            type="date"
            max={today}
            value={filters.from ?? ''}
            onChange={(e) => set({ from: e.target.value || null })}
            className="num h-11 rounded-control border border-border px-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          إلى
          <input
            type="date"
            max={today}
            value={filters.to ?? ''}
            onChange={(e) => set({ to: e.target.value || null })}
            className="num h-11 rounded-control border border-border px-2"
          />
        </label>
      </div>

      {history.isPending && <p className="m-0 text-sm text-text-muted">جارٍ التحميل…</p>}
      {history.error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {errorMessage(history.error)}
        </p>
      )}
      {history.isSuccess && rows.length === 0 && (
        <p className="m-0 text-sm text-text-muted" data-testid="history-empty">
          ماكو تسليمات
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[760px] border-collapse text-sm"
            data-testid="history-table"
          >
            <thead>
              <tr className="bg-background text-right text-text-muted">
                {[
                  'الوقت',
                  'السائق',
                  'استلمها',
                  'الطلبات',
                  'المطلوب',
                  'المستلم',
                  'الفرق',
                  'ملاحظة',
                  '',
                ].map((h, i) => (
                  <th key={i} scope="col" className="px-2.5 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <HistoryLine key={r.id} row={r} admin={role === 'admin'} onCorrect={onCorrect} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history.hasNextPage && (
        <button
          type="button"
          data-testid="history-more"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
          className="h-11 self-start rounded-control border border-border bg-surface px-4 text-sm disabled:opacity-60"
        >
          {history.isFetchingNextPage ? 'جارٍ التحميل…' : 'عرض المزيد'}
        </button>
      )}
    </div>
  );
}

function HistoryLine({
  row,
  admin,
  onCorrect,
}: {
  row: HandoverRow;
  admin: boolean;
  onCorrect: (row: HandoverRow) => void;
}) {
  return (
    <tr
      data-handover-id={row.id}
      data-driver-name={row.driver_name ?? ''}
      className="border-t border-divider align-top"
    >
      <td className="num whitespace-nowrap px-2.5 py-2">{formatDateTime(row.recorded_at)}</td>
      <td className="px-2.5 py-2 font-semibold">{row.driver_name ?? 'سائق محذوف'}</td>
      <td className="px-2.5 py-2">{row.recorded_by_name ?? 'محذوف'}</td>
      <td className="num px-2.5 py-2">{row.order_count}</td>
      <td className="px-2.5 py-2">
        <span className="num">{formatIQD(row.expected_iqd)}</span>
        <br />
        <span className="text-xs text-text-muted">{basisLabel(row.includes_delivery_fee)}</span>
      </td>
      <td className="num px-2.5 py-2">{formatIQD(row.received_iqd)}</td>
      <td className="px-2.5 py-2">
        <div className="flex flex-col gap-1">
          <DiffBadge diff={diffFromSigned(row.difference_iqd)} testId="history-diff" />
          {row.corrected_at && (
            <span className="text-xs text-text-muted" data-testid="history-corrected">
              مُصحَّح
              {admin && row.original_received_iqd !== null && (
                <>
                  {' '}
                  (الأصلي <span className="num">{formatIQD(row.original_received_iqd)}</span>)
                </>
              )}
            </span>
          )}
        </div>
      </td>
      <td className="max-w-[260px] break-words px-2.5 py-2">{row.note}</td>
      <td className="px-2.5 py-2">
        {admin && (
          <button
            type="button"
            data-testid="correct-handover"
            onClick={() => onCorrect(row)}
            className="h-9 rounded-md border border-border bg-surface px-3 text-xs font-bold"
          >
            تصحيح
          </button>
        )}
      </td>
    </tr>
  );
}
