'use client';
// تبويب "الأرصدة" (SPEC-cash §4، C1): صف لكل سائق برصيده، وزر "استلام الكاش" (معطّل برصيد 0).
import { formatIQD } from '@mukhdar/shared';
import { displayPhone, phoneLinks } from '@/features/orders/format';
import type { OutstandingRow } from './api';
import { DiffBadge } from './DiffBadge';
import { diffFromSigned } from './difference';
import { basisLabel, lastHandoverLine, oldestLine } from './text';

export function BalancesTab({
  rows,
  onReceive,
}: {
  rows: readonly OutstandingRow[];
  onReceive: (row: OutstandingRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="m-0 py-3 text-sm text-text-muted" data-testid="cash-empty">
        ماكو سواق بعد
      </p>
    );
  }
  return (
    <div className="flex flex-col" data-testid="cash-balances">
      {rows.map((r, i) => {
        const links = phoneLinks(r.phone);
        const oldest = oldestLine(r.oldest_delivered_at);
        return (
          <article
            key={r.driver_id}
            data-driver-name={r.full_name ?? ''}
            data-outstanding={r.outstanding_iqd}
            className={`flex flex-wrap items-center gap-3 py-3.5 ${i === 0 ? '' : 'border-t border-divider'}`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary">
              {(r.full_name ?? '؟').trim().charAt(0) || '؟'}
            </span>
            <span className="flex min-w-[170px] flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">
                {r.full_name ?? 'سائق'}
                {!r.is_active && (
                  <span className="text-xs font-normal text-text-muted"> (غير مفعّل)</span>
                )}
              </span>
              {r.phone && (
                <span className="flex items-center gap-2 text-[13px] text-text-muted">
                  <span className="num" dir="ltr">
                    {displayPhone(r.phone)}
                  </span>
                  {links && (
                    <a href={links.tel} className="text-primary">
                      اتصال
                    </a>
                  )}
                </span>
              )}
              <span className="text-xs text-text-muted">
                {lastHandoverLine(r.last_handover_at, r.last_received_iqd, r.last_difference_iqd)}
              </span>
              {r.last_difference_iqd ? (
                <DiffBadge diff={diffFromSigned(r.last_difference_iqd)} />
              ) : null}
            </span>
            <span className="flex min-w-[150px] flex-col items-end gap-0.5">
              <span className="num text-2xl font-bold" data-testid="driver-balance">
                {formatIQD(r.outstanding_iqd)}
              </span>
              <span className="num text-[13px] text-text-muted">{r.order_count} طلب</span>
              {r.outstanding_iqd > 0 && (
                <span className="text-xs text-text-muted">
                  {basisLabel(r.includes_delivery_fee)}
                </span>
              )}
              {oldest && <span className="text-xs text-text-muted">{oldest}</span>}
            </span>
            <button
              type="button"
              data-testid="receive-cash"
              disabled={r.outstanding_iqd <= 0}
              onClick={() => onReceive(r)}
              className="h-11 rounded-control bg-primary px-4 text-sm font-bold text-white disabled:opacity-40"
            >
              استلام الكاش
            </button>
          </article>
        );
      })}
    </div>
  );
}
