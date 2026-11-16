'use client';
// الرئيسية (T25، SPEC-admin §2.0، تصميم "الرئيسية" المعتمد). كل الأرقام من dashboard_today(): لا جمع بالمتصفح.
// الموظف: الدالة نفسها ترجع المال null، فلا تُعرض بطاقات المال ولا عمود المجموع ولا أي "د.ع".
// التحديث الحي: اشتراك Realtime القائم على orders (PanelProviders) يبطل المفاتيح تحت ['orders'] ومنها
// هذه الصفحة؛ والمخزون والنافذة "حتى نفس الدقيقة" باستطلاع كل دقيقة (DASHBOARD_POLL_MS).
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatAdminQuantity } from '@mukhdar/shared';
import { usePanel } from '@/components/PanelProviders';
import { OrdersTable, type OrdersColumn } from '@/features/orders/OrdersTable';
import { formatTime } from '@/features/orders/format';
import {
  DASHBOARD_POLL_MS,
  dashboardKeys,
  fetchDashboard,
  fetchStoreOpen,
  fetchTodayOrders,
  type LowStockItem,
} from './api';
import { type Tone } from './delta';
import { buildKpis } from './kpis';

const WEEKDAY = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { weekday: 'long', timeZone: 'UTC' });
const NO_DRIVERS: ReadonlyMap<string, string> = new Map();

const TONE_CLASS: Record<Tone, string> = {
  good: 'text-primary',
  bad: 'text-danger',
  flat: 'text-text-muted',
};

/** ألوان البلاطات من التصميم المعتمد. */
const OPEN_TILES = [
  { key: 'pending', label: 'جديد، يحتاج تحضير', bg: '#FFF1DC', fg: '#7A4A00' },
  { key: 'preparing', label: 'قيد التحضير', bg: '#E3EEFB', fg: '#1C4F8A' },
  { key: 'ready', label: 'جاهز، بانتظار سائق', bg: '#DDF2EF', fg: '#13615A' },
  { key: 'out_for_delivery', label: 'بالطريق', bg: '#EFE6FA', fg: '#5B2E91' },
] as const;

const card = 'rounded-card border border-border bg-surface';

function greeting(asOf: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Baghdad',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date(asOf)),
  );
  return hour < 12 ? 'صباح الخير' : 'مساء الخير';
}

export function DashboardScreen() {
  const { supabase, role, newOrderIds } = usePanel();
  const router = useRouter();

  const dash = useQuery({
    queryKey: dashboardKeys.today,
    queryFn: () => fetchDashboard(supabase),
    refetchInterval: DASHBOARD_POLL_MS,
  });
  const day = dash.data?.day;
  const orders = useQuery({
    queryKey: dashboardKeys.orders(day ?? ''),
    queryFn: () => fetchTodayOrders(supabase, day ?? ''),
    enabled: !!day,
    refetchInterval: DASHBOARD_POLL_MS,
  });
  const store = useQuery({
    queryKey: dashboardKeys.storeOpen,
    queryFn: () => fetchStoreOpen(supabase),
    refetchInterval: DASHBOARD_POLL_MS,
  });

  const d = dash.data;
  // الموظف بلا مجموع (قاعدة "لا رقم بالدينار")؛ الأدمن بلا زبون وسائق كالتصميم
  const columns: OrdersColumn[] =
    role === 'admin'
      ? ['order', 'time', 'address', 'total', 'status']
      : ['order', 'time', 'address', 'status'];

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-[26px] font-bold">{d ? greeting(d.as_of) : 'الرئيسية'}</h1>
          {d && (
            <span className="text-sm text-text-muted" data-testid="home-subtitle">
              اليوم {WEEKDAY.format(new Date(`${d.day}T12:00:00Z`))} · المقارنة وي أمس لنفس الساعة (
              <span className="num">{formatTime(d.as_of)}</span>)
            </span>
          )}
        </div>
        {d?.stuck_notifications ? (
          <Link
            href="/settings#notifications"
            data-testid="stuck-badge"
            className="flex h-10 items-center gap-2 rounded-full bg-warning-soft px-3.5 text-sm font-semibold text-warning-text no-underline"
          >
            <span aria-hidden="true">!</span>
            <span>
              <span className="num">{d.stuck_notifications}</span> إشعار عالق
            </span>
          </Link>
        ) : null}
        {store.data !== undefined && (
          <span
            className={`flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-semibold ${
              store.data ? 'bg-primary-soft text-primary' : 'bg-danger-soft text-danger'
            }`}
            data-testid="store-status"
          >
            <span
              className={`h-2 w-2 rounded-full ${store.data ? 'bg-primary' : 'bg-danger'}`}
              aria-hidden="true"
            />
            {store.data ? 'المحل مفتوح' : 'المحل مسكّر'}
          </span>
        )}
      </header>

      {dash.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-card bg-danger-soft p-4 text-danger"
        >
          تعذّر تحميل مؤشرات اليوم.
          <button
            type="button"
            onClick={() => void dash.refetch()}
            className="min-h-11 rounded-control border border-danger px-4 font-semibold"
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      {!d && !dash.isError && (
        <p role="status" className="text-sm text-text-muted">
          جارٍ التحميل…
        </p>
      )}

      {d && (
        <>
          <section
            aria-label="مؤشرات اليوم"
            className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3"
          >
            {buildKpis(d).map((k) => {
              const body = (
                <>
                  <span className="flex items-center justify-between gap-1.5 text-[13px] text-text-muted">
                    <span>{k.label}</span>
                    {/* بطاقات الأدمن فقط تُعلَّم "للأدمن"؛ الموظف لا يراها أصلاً */}
                    <span className="rounded-full bg-[#F2F4EF] px-2 py-0.5 text-[11px] whitespace-nowrap">
                      {k.tag}
                    </span>
                  </span>
                  {/* الرقم كاملاً دائماً: يلتف ولا يُقص (SPEC-admin §2.0) */}
                  <span
                    className={`num text-[26px] leading-tight font-bold [overflow-wrap:anywhere] ${k.valueClass ?? ''}`}
                    data-testid={`kpi-${k.id}-value`}
                  >
                    {k.value}
                  </span>
                  <span
                    className={`text-[13px] font-semibold ${TONE_CLASS[k.delta.tone]}`}
                    data-testid={`kpi-${k.id}-delta`}
                  >
                    {k.delta.text}
                  </span>
                </>
              );
              const cls = `${card} flex min-w-0 flex-col gap-1.5 p-4`;
              return k.href ? (
                <Link
                  key={k.id}
                  href={k.href}
                  data-testid={`kpi-${k.id}`}
                  className={`${cls} no-underline`}
                >
                  {body}
                </Link>
              ) : (
                <div key={k.id} data-testid={`kpi-${k.id}`} className={cls}>
                  {body}
                </div>
              );
            })}
          </section>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-4">
            <section
              aria-label="الطلبات المفتوحة"
              className={`${card} flex flex-col gap-3 p-[18px]`}
            >
              <h2 className="m-0 text-[17px] font-bold">الطلبات المفتوحة هسه</h2>
              <div className="grid grid-cols-2 gap-2">
                {OPEN_TILES.map((t) => (
                  <Link
                    key={t.key}
                    href={`/orders?tab=${t.key}`}
                    data-testid={`open-${t.key}`}
                    className="flex min-h-16 flex-col justify-center rounded-control px-3 py-2.5 no-underline"
                    style={{ background: t.bg, color: t.fg }}
                  >
                    <span className="num text-[22px] font-bold" data-testid={`open-${t.key}-value`}>
                      {d.open[t.key]}
                    </span>
                    <span className="text-[13px]">{t.label}</span>
                  </Link>
                ))}
              </div>
            </section>

            <section aria-label="نقص المخزون" className={`${card} flex flex-col gap-2.5 p-[18px]`}>
              <div className="flex items-center justify-between">
                <h2 className="m-0 text-[17px] font-bold">مخزون قليل</h2>
                <Link
                  href="/stock"
                  className="flex min-h-8 items-center text-sm font-semibold no-underline"
                >
                  كل المخزون
                </Link>
              </div>
              {d.low_stock_items.length === 0 ? (
                <p className="m-0 text-sm text-text-muted" role="status">
                  كل المنتجات فوق حد التنبيه.
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0" data-testid="low-stock-list">
                  {d.low_stock_items.map((it) => (
                    <LowStockRow key={it.product_id} item={it} />
                  ))}
                </ul>
              )}
              {d.low_stock_count > d.low_stock_items.length && (
                <Link href="/stock" className="text-sm font-semibold no-underline">
                  و{d.low_stock_count - d.low_stock_items.length} منتج آخر
                </Link>
              )}
            </section>
          </div>

          <section aria-label="طلبات اليوم" className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between px-[18px] pt-4 pb-1.5">
              <h2 className="m-0 text-[17px] font-bold">طلبات اليوم</h2>
              <Link
                href="/orders"
                className="flex min-h-8 items-center text-sm font-semibold no-underline"
              >
                كل الطلبات
              </Link>
            </div>
            <OrdersTable
              bare
              caption="طلبات اليوم"
              rows={orders.data ?? []}
              driverNames={NO_DRIVERS}
              newIds={newOrderIds}
              columns={columns}
              loading={orders.isPending}
              emptyText="ماكو طلبات اليوم لحد الآن"
              onSelect={(id) => router.push(`/orders?order=${id}`)}
              footer={
                d.placed_count > (orders.data?.length ?? 0) ? (
                  <p className="m-0 border-t border-divider p-3 text-center text-sm text-text-muted">
                    <Link href="/orders" className="font-semibold no-underline">
                      كل طلبات اليوم ({d.placed_count})
                    </Link>
                  </p>
                ) : undefined
              }
            />
          </section>
        </>
      )}
    </div>
  );
}

function LowStockRow({ item }: { item: LowStockItem }) {
  const out = item.qty === 0;
  return (
    <li
      className="flex min-h-10 items-center justify-between gap-2 border-b border-divider text-sm last:border-b-0"
      data-testid="low-stock-item"
    >
      <span className="font-semibold">{item.name}</span>
      {out ? (
        <span className="font-bold text-danger">نفد</span>
      ) : (
        <span className="num font-bold text-warning-text">
          {formatAdminQuantity(item.qty, item.unit)} من حد{' '}
          {formatAdminQuantity(item.threshold, item.unit)}
        </span>
      )}
    </li>
  );
}
