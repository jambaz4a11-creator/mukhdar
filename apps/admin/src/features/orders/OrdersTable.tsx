'use client';
// جدول الطلبات: مكوّن واحد لصفحة الطلبات والرئيسية (T25). لا كلفة ولا ربح هنا.
import { formatIQD } from '@mukhdar/shared';
import type { OrderRow } from './api';
import { formatTime, shortAddress } from './format';
import { StatusBadge } from './StatusBadge';

export type OrdersColumn =
  'order' | 'time' | 'customer' | 'address' | 'total' | 'driver' | 'status';

const COLUMN_LABELS: Record<OrdersColumn, string> = {
  order: 'الطلب',
  time: 'الوقت',
  customer: 'الزبون',
  address: 'العنوان',
  total: 'المجموع',
  driver: 'السائق',
  status: 'الحالة',
};

const ALL_COLUMNS: readonly OrdersColumn[] = [
  'order',
  'time',
  'customer',
  'address',
  'total',
  'driver',
  'status',
];

interface Props {
  rows: OrderRow[];
  driverNames: ReadonlyMap<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** طلبات وصلت الآن عبر Realtime (تمييز خفيف) */
  newIds?: ReadonlySet<string>;
  emptyText?: string;
  loading?: boolean;
  footer?: React.ReactNode;
  caption?: string;
  /** أعمدة مختارة بترتيبها (الرئيسية: بلا زبون وسائق، وللموظف بلا مجموع). الافتراضي كل الأعمدة. */
  columns?: readonly OrdersColumn[];
  /** بلا إطار خارجي: داخل بطاقة لها عنوان (الرئيسية) */
  bare?: boolean;
}

export function OrdersTable({
  rows,
  driverNames,
  selectedId,
  onSelect,
  newIds,
  emptyText = 'ماكو طلبات بهذي الحالة',
  loading,
  footer,
  caption = 'قائمة الطلبات',
  columns = ALL_COLUMNS,
  bare = false,
}: Props) {
  const has = (c: OrdersColumn) => columns.includes(c);
  return (
    <section
      aria-label={caption}
      className={`min-w-0 overflow-x-auto bg-surface ${bare ? '' : 'rounded-card border border-border'}`}
    >
      <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="orders-table">
        <thead>
          <tr className="bg-background text-right text-text-muted">
            {columns.map((c) => (
              <th key={c} scope="col" className="px-3.5 py-3 font-semibold">
                {COLUMN_LABELS[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const selected = r.id === selectedId;
            const isNew = newIds?.has(r.id);
            return (
              <tr
                key={r.id}
                data-order-number={r.order_number}
                aria-selected={selected}
                className={`border-t border-divider ${
                  selected ? 'bg-primary-soft/60' : isNew ? 'bg-warning-soft/60' : 'bg-surface'
                }`}
              >
                {has('order') && (
                  <td className="p-0">
                    <button
                      type="button"
                      onClick={() => onSelect?.(r.id)}
                      className="num min-h-[52px] w-full px-3.5 text-right font-bold"
                      aria-label={`الطلب رقم ${r.order_number}`}
                    >
                      #{r.order_number}
                    </button>
                  </td>
                )}
                {has('time') && (
                  <td className="num px-3.5 whitespace-nowrap text-text-muted">
                    {formatTime(r.created_at)}
                  </td>
                )}
                {has('customer') && <td className="px-3.5">{r.customer_name ?? '—'}</td>}
                {has('address') && (
                  <td className="px-3.5 whitespace-nowrap">{shortAddress(r.address_snapshot)}</td>
                )}
                {has('total') && (
                  <td className="num px-3.5 font-semibold whitespace-nowrap">
                    {formatIQD(r.total_iqd)}
                  </td>
                )}
                {has('driver') && (
                  <td className="px-3.5 text-text-muted">
                    {r.driver_id ? (driverNames.get(r.driver_id) ?? 'سائق') : '—'}
                  </td>
                )}
                {has('status') && (
                  <td className="px-3.5">
                    <StatusBadge status={r.status} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="p-8 text-center text-text-muted" role="status">
          {loading ? 'جارٍ التحميل…' : emptyText}
        </p>
      )}
      {footer}
    </section>
  );
}
