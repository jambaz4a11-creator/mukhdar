import { STATUS_COLORS, STATUS_LABELS, type OrderStatus } from '@mukhdar/shared';

export function StatusBadge({ status }: { status: OrderStatus }) {
  const c = STATUS_COLORS[status];
  return (
    <span
      className="inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
      style={{ color: c.text, background: c.background }}
      data-status={status}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
