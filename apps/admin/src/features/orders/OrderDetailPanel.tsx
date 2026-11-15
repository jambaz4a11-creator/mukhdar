'use client';
// لوحة تفاصيل الطلب: الزبون (اتصال وواتساب)، العنوان الكامل وملاحظته، ملاحظة الطلب، البنود (formatQuantity)،
// المجاميع، سجل الحالات، التقييم، والإجراءات حسب الحالة والدور. الكلفة والربح للأدمن فقط (لا تُجلب للموظف).
import { STATUS_LABELS, errorMessage, formatIQD, formatQuantity } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import {
  ACTION_LABELS,
  ACTION_TARGET,
  CANCEL_REASON_MAX,
  actionBlocked,
  orderActions,
  validateCancelReason,
} from './actions';
import {
  assignDriver,
  fetchOrderCosts,
  fetchOrderDetail,
  ordersKeys,
  setOrderStatus,
  type Driver,
} from './api';
import {
  asAddress,
  costAndProfit,
  displayPhone,
  formatDateTime,
  formatTime,
  fullAddress,
  phoneLinks,
} from './format';
import { StatusBadge } from './StatusBadge';

interface Props {
  orderId: string;
  drivers: Driver[];
  onClose: () => void;
}

export function OrderDetailPanel({ orderId, drivers, onClose }: Props) {
  const { supabase, role } = usePanel();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ordersKeys.detail(orderId, role),
    queryFn: async () => {
      const order = await fetchOrderDetail(supabase, orderId);
      if (!order) return null;
      // الأدمن فقط: كلفة البنود. للموظف لا طلب أصلاً (fetchOrderCosts يرجع null بلا استعلام).
      const costs = await fetchOrderCosts(
        supabase,
        role,
        order.order_items.map((i) => i.id),
      );
      return { order, costs };
    },
  });

  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [driverId, setDriverId] = useState('');

  const done = async () => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: ordersKeys.all });
  };
  const statusMutation = useMutation({
    mutationFn: ({ status, why }: { status: Parameters<typeof setOrderStatus>[2]; why?: string }) =>
      setOrderStatus(supabase, orderId, status, why),
    onSuccess: async () => {
      setCancelling(false);
      setReason('');
      await done();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const assignMutation = useMutation({
    mutationFn: (id: string) => assignDriver(supabase, orderId, id),
    onSuccess: async () => {
      setDriverId('');
      await done();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const busy = statusMutation.isPending || assignMutation.isPending;

  if (detail.isPending) return <Shell onClose={onClose}>جارٍ التحميل…</Shell>;
  if (detail.isError) return <Shell onClose={onClose}>تعذّر تحميل الطلب، حاول مرة ثانية.</Shell>;
  if (!detail.data) return <Shell onClose={onClose}>ما لقينا هذا الطلب.</Shell>;

  const { order, costs } = detail.data;
  const address = asAddress(order.address_snapshot);
  const links = phoneLinks(order.customer_phone);
  const actions = orderActions(order.status, role);
  const currentDriver = order.driver_id ? drivers.find((d) => d.id === order.driver_id) : undefined;
  const activeDrivers = drivers.filter((d) => d.is_active && d.id !== order.driver_id);
  const money = costs ? costAndProfit(order.order_items, costs, order.subtotal_iqd) : null;
  const reasonError = cancelling ? validateCancelReason(reason) : null;

  return (
    <aside
      aria-label="تفاصيل الطلب"
      data-testid="order-detail"
      className="flex max-w-full min-w-0 flex-[1_1_340px] flex-col gap-3.5 rounded-card border border-border bg-surface p-[18px]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="num text-xl font-bold">الطلب #{order.order_number}</h2>
        <div className="flex items-center gap-2">
          <StatusBadge status={order.status} />
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق التفاصيل"
            className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-background"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">
          {order.customer_name ?? 'بدون اسم'}
          {order.customer_phone && (
            <>
              {' · '}
              <span dir="ltr" className="num" data-testid="customer-phone">
                {displayPhone(order.customer_phone)}
              </span>
            </>
          )}
        </span>
        {links && (
          <span className="flex gap-2">
            <a
              href={links.tel}
              className="flex min-h-9 items-center rounded-control border border-border px-3 font-medium no-underline"
            >
              اتصال
            </a>
            <a
              href={links.whatsapp}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-9 items-center rounded-control border border-border px-3 font-medium no-underline"
            >
              واتساب
            </a>
          </span>
        )}
        <span data-testid="order-address">{fullAddress(address)}</span>
        {address.note && (
          <span className="text-text-muted" data-testid="address-note">
            ملاحظة العنوان: {address.note}
          </span>
        )}
        <span className="num text-text-muted">
          وصل {formatTime(order.created_at)} · نقداً عند الاستلام
        </span>
        {order.note && (
          <p
            className="rounded-control bg-warning-soft px-3 py-2 text-warning-text"
            data-testid="order-note"
          >
            ملاحظة الطلب: {order.note}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-control bg-background p-3">
        <span className="text-[13px] font-bold text-text-muted">للتحضير</span>
        {order.order_items.map((i) => (
          <div key={i.id} className="flex justify-between gap-3 text-sm" data-testid="order-item">
            <span>{i.name_snapshot}</span>
            <span className="num font-semibold whitespace-nowrap">
              {formatQuantity(i.qty, i.unit_snapshot)}
            </span>
          </div>
        ))}
      </div>

      <dl className="flex flex-col gap-1.5 text-sm">
        <Row label="المجموع الفرعي" value={formatIQD(order.subtotal_iqd)} />
        <Row label="أجرة التوصيل" value={formatIQD(order.delivery_fee_iqd)} />
        <Row label="الكلي" value={formatIQD(order.total_iqd)} strong />
        {money && (
          <div className="flex justify-between text-[13px] text-primary" data-testid="order-profit">
            <dt>التكلفة / الربح (للأدمن)</dt>
            <dd className="num">
              {formatIQD(money.cost)} / {formatIQD(money.profit)}
              {money.missing > 0 ? ' (ناقص)' : ''}
            </dd>
          </div>
        )}
      </dl>

      {order.driver_id && (
        <p className="text-sm">
          السائق: <span className="font-semibold">{currentDriver?.full_name ?? 'سائق'}</span>
          {currentDriver && (
            <span dir="ltr" className="num text-text-muted">
              {' '}
              {displayPhone(currentDriver.phone)}
            </span>
          )}
        </p>
      )}

      {order.cancel_reason && (
        <p
          className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
          data-testid="cancel-reason"
        >
          سبب الإلغاء: {order.cancel_reason}
        </p>
      )}

      {error && (
        <p
          role="alert"
          data-testid="action-error"
          className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {actions
          .filter((a) => a === 'start_preparing' || a === 'mark_ready')
          .map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy}
              onClick={() => {
                const target = ACTION_TARGET[a];
                if (target) statusMutation.mutate({ status: target });
              }}
              className="h-12 rounded-control bg-primary text-[15px] font-bold text-white hover:bg-primary-pressed disabled:opacity-60"
            >
              {ACTION_LABELS[a]}
            </button>
          ))}

        {actions.includes('assign_driver') && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="assign-driver" className="text-[13px] font-semibold">
              {order.driver_id ? 'تغيير السائق' : 'تعيين سائق'}
              {!order.driver_id && order.status === 'ready' && (
                <span className="font-normal text-text-muted"> (أو أول سائق يقبل)</span>
              )}
            </label>
            <div className="flex gap-2">
              <select
                id="assign-driver"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-control border border-border bg-surface px-2.5 text-sm"
              >
                <option value="">اختر سائقاً</option>
                {activeDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!driverId || busy}
                onClick={() => assignMutation.mutate(driverId)}
                className="h-11 rounded-control border border-primary px-4 text-sm font-semibold text-primary disabled:opacity-50"
              >
                تعيين
              </button>
            </div>
          </div>
        )}

        {actions
          .filter((a) => a === 'mark_out_for_delivery' || a === 'mark_delivered')
          .map((a) => {
            const blocked = actionBlocked(a, order);
            return (
              <div key={a} className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={busy || blocked !== null}
                  onClick={() => {
                    const target = ACTION_TARGET[a];
                    if (!target) return;
                    // احتياطي بدل السائق: تأكيد قبل التنفيذ
                    if (!window.confirm(`${ACTION_LABELS[a]}؟ استخدمه فقط إن تعذّر على السائق.`))
                      return;
                    statusMutation.mutate({ status: target });
                  }}
                  className="h-11 rounded-control border border-primary bg-surface text-sm font-semibold text-primary disabled:opacity-50"
                >
                  {ACTION_LABELS[a]}
                </button>
                {blocked && <span className="text-xs text-text-muted">{blocked}</span>}
              </div>
            );
          })}

        <div className="flex gap-2">
          <a
            href={`/print/orders/${order.id}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-control border border-border text-sm text-text no-underline"
          >
            <PrintIcon />
            طباعة
          </a>
          {actions.includes('cancel') && !cancelling && (
            <button
              type="button"
              onClick={() => setCancelling(true)}
              className="h-11 flex-1 rounded-control border border-[#F3CFCA] bg-danger-soft text-sm text-danger"
            >
              {ACTION_LABELS.cancel}
            </button>
          )}
        </div>

        {cancelling && (
          <form
            className="flex flex-col gap-2 rounded-control border border-[#F3CFCA] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (validateCancelReason(reason)) return;
              statusMutation.mutate({ status: 'cancelled', why: reason.trim() });
            }}
          >
            <label htmlFor="cancel-reason" className="text-sm font-semibold">
              سبب الإلغاء (يصل للزبون)
            </label>
            <textarea
              id="cancel-reason"
              value={reason}
              maxLength={CANCEL_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="rounded-input border border-border p-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!!reasonError || busy}
                className="h-11 flex-1 rounded-control bg-danger text-sm font-semibold text-white disabled:opacity-50"
              >
                تأكيد الإلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancelling(false);
                  setReason('');
                }}
                className="h-11 flex-1 rounded-control border border-border text-sm"
              >
                تراجع
              </button>
            </div>
          </form>
        )}
      </div>

      <section
        aria-label="سجل الحالات"
        className="flex flex-col gap-1.5 border-t border-divider pt-3 text-sm"
      >
        <h3 className="text-[13px] font-bold text-text-muted">سجل الحالات</h3>
        <ol className="flex flex-col gap-1" data-testid="status-history">
          {order.order_status_history.map((h) => (
            <li key={h.id} className="flex justify-between gap-3">
              <span>
                {STATUS_LABELS[h.to_status]}
                {h.note ? <span className="text-text-muted"> · {h.note}</span> : null}
              </span>
              <span className="num whitespace-nowrap text-text-muted">
                {formatDateTime(h.created_at)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {order.ratings && (
        <section
          aria-label="التقييم"
          className="flex flex-col gap-1 border-t border-divider pt-3 text-sm"
          data-testid="order-rating"
        >
          <h3 className="text-[13px] font-bold text-text-muted">التقييم</h3>
          <span className="text-star" aria-label={`${order.ratings.stars} من 5`}>
            {'★'.repeat(order.ratings.stars)}
            <span className="text-border">{'★'.repeat(5 - order.ratings.stars)}</span>
          </span>
          {order.ratings.comment && <p>{order.ratings.comment}</p>}
        </section>
      )}
    </aside>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <aside
      aria-label="تفاصيل الطلب"
      className="flex flex-[1_1_340px] items-start justify-between gap-2 rounded-card border border-border bg-surface p-[18px] text-sm text-text-muted"
    >
      <span>{children}</span>
      <button type="button" onClick={onClose} aria-label="إغلاق التفاصيل" className="size-9">
        ✕
      </button>
    </aside>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'text-base font-bold' : ''}`}>
      <dt className={strong ? '' : 'text-text-muted'}>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function PrintIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z" />
    </svg>
  );
}
