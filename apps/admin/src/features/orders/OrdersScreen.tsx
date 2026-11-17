'use client';
// صفحة الطلبات (SPEC-admin §2.1، تصميم "Orders"): تبويبات بعدادات حية، بحث، يوم، سائق، جدول بصفحات 50،
// ولوحة تفاصيل. حالة الفلاتر بالرابط (?tab=&day=&driver=&q=&order=) حتى يعمل الرجوع والمشاركة.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { useUrlParams } from '@/lib/urlParams';
import { fetchDrivers, fetchOrdersPage, fetchTabCounts, ordersKeys } from './api';
import {
  DAY_TABS,
  TABS,
  baghdadToday,
  isDay,
  parseTab,
  tabLabel,
  type OrdersFilters,
} from './filters';
import { OrderDetailPanel } from './OrderDetailPanel';
import { OrdersTable } from './OrdersTable';

export function OrdersScreen() {
  const { supabase, role, newOrderIds, realtimeStatus } = usePanel();
  const params = useSearchParams();
  const today = baghdadToday();

  const filters: OrdersFilters = {
    tab: parseTab(params.get('tab')),
    day: isDay(params.get('day')) ? params.get('day') : null,
    driverId: params.get('driver') || null,
    search: params.get('q') ?? '',
  };
  const selectedId = params.get('order');
  const isDayTab = DAY_TABS.includes(filters.tab);
  const countsDay = isDayTab && filters.day ? filters.day : today;

  // يقرأ الرابط لحظة الاستدعاء (M2): نقرتان سريعتان أو مؤقت البحث المتأخر لا يلغيان بعضهما
  const setParams = useUrlParams();

  // البحث يُكتب محلياً ويُطبَّق بعد توقف قصير
  const [searchInput, setSearchInput] = useState(filters.search);
  const lastCommittedQ = useRef(filters.search);
  useEffect(() => {
    if (searchInput.trim() === filters.search) return;
    const t = setTimeout(() => {
      lastCommittedQ.current = searchInput.trim();
      setParams({ q: searchInput.trim() || null, order: null });
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput, filters.search]);
  // q تغيّر من خارج الكتابة (رابط، رجوع، تبويب): نظهره بالمربع كي لا يبقى بحث غير مطبّق ظاهراً
  useEffect(() => {
    if (filters.search !== lastCommittedQ.current) {
      lastCommittedQ.current = filters.search;
      setSearchInput(filters.search);
    }
  }, [filters.search]);

  const drivers = useQuery({
    queryKey: ordersKeys.drivers,
    queryFn: () => fetchDrivers(supabase),
    staleTime: 60_000,
  });
  const driverNames = useMemo(
    () => new Map((drivers.data ?? []).map((d) => [d.id, d.full_name])),
    [drivers.data],
  );

  const counts = useQuery({
    queryKey: [...ordersKeys.counts(countsDay), filters.driverId],
    queryFn: () => fetchTabCounts(supabase, countsDay, filters.driverId),
  });

  const list = useInfiniteQuery({
    queryKey: ordersKeys.list(filters, today),
    queryFn: ({ pageParam }) => fetchOrdersPage(supabase, filters, today, pageParam),
    initialPageParam: null as null | { created_at: string; id: string },
    getNextPageParam: (last) => (last === 'invalid' ? null : last.next),
  });
  const invalidSearch = list.data?.pages[0] === 'invalid';
  const rows = useMemo(
    () => (list.data?.pages ?? []).flatMap((p) => (p === 'invalid' ? [] : p.rows)),
    [list.data],
  );

  const searching = filters.search.trim() !== '';

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-[26px] font-bold">الطلبات</h1>
          <span
            role="status"
            data-testid="realtime-status"
            data-state={realtimeStatus}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] ${
              realtimeStatus === 'live'
                ? 'bg-primary-soft text-primary'
                : 'bg-warning-soft text-warning-text'
            }`}
          >
            <span
              className={`size-2 rounded-full ${realtimeStatus === 'live' ? 'bg-primary' : 'bg-warning-text'}`}
            />
            {realtimeStatus === 'live'
              ? 'تحديث مباشر'
              : realtimeStatus === 'connecting'
                ? 'جارٍ الاتصال…'
                : 'التحديث المباشر متوقف'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex h-11 min-w-[260px] flex-1 items-center gap-2 rounded-control border border-border bg-surface px-3">
            <SearchIcon />
            <span className="sr-only">بحث</span>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="رقم الطلب أو هاتف الزبون"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <label className="flex h-11 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm">
            <span className="text-text-muted">{isDayTab ? 'اليوم' : 'تاريخ الطلب'}</span>
            <input
              type="date"
              aria-label="التاريخ"
              value={filters.day ?? (isDayTab ? today : '')}
              max={today}
              onChange={(e) =>
                setParams({
                  day: e.target.value === today && isDayTab ? null : e.target.value || null,
                  order: null,
                })
              }
              className="num bg-transparent outline-none"
            />
          </label>
          <label className="flex h-11 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm">
            <span className="text-text-muted">السائق</span>
            <select
              aria-label="فلتر السائق"
              value={filters.driverId ?? ''}
              onChange={(e) => setParams({ driver: e.target.value || null, order: null })}
              className="bg-transparent outline-none"
            >
              <option value="">الكل</option>
              {(drivers.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                  {d.is_active ? '' : ' (معطّل)'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {role === 'staff' && (
        <p className="m-0 text-xs text-text-muted" data-testid="staff-window-note">
          تظهر لك الطلبات المفتوحة وطلبات آخر 7 أيام فقط. الأقدم من ذلك عند المدير.
        </p>
      )}

      <div role="tablist" aria-label="حالة الطلب" className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const selected = !searching && tab === filters.tab;
          const count = counts.data?.[tab];
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              data-tab={tab}
              onClick={() => {
                setSearchInput('');
                setParams({ tab, day: null, order: null, q: null });
              }}
              className={`flex h-11 items-center gap-2 rounded-control border px-4 text-sm ${
                selected
                  ? 'border-primary bg-primary font-semibold text-white'
                  : 'border-border bg-surface text-text'
              }`}
            >
              {tabLabel(tab, countsDay, today)}
              <span
                data-testid={`count-${tab}`}
                className={`num flex h-[22px] min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
                  selected ? 'bg-surface text-primary' : 'bg-background text-text-muted'
                }`}
              >
                {count ?? '…'}
              </span>
            </button>
          );
        })}
      </div>

      {searching && (
        <p className="text-sm text-text-muted" role="status">
          {invalidSearch
            ? 'اكتب رقم طلب (مثل 1048) أو رقم هاتف (07XXXXXXXXX).'
            : `نتائج البحث عن «${filters.search}» بكل الحالات والتواريخ.`}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_520px]">
          <OrdersTable
            rows={rows}
            driverNames={driverNames}
            selectedId={selectedId}
            onSelect={(id) => setParams({ order: id })}
            newIds={newOrderIds}
            loading={list.isPending}
            emptyText={searching ? 'ما لقينا طلباً بهذا البحث' : 'ماكو طلبات بهذي الحالة'}
            footer={
              list.hasNextPage ? (
                <div className="border-t border-divider p-3 text-center">
                  <button
                    type="button"
                    onClick={() => void list.fetchNextPage()}
                    disabled={list.isFetchingNextPage}
                    className="h-11 rounded-control border border-border px-4 text-sm font-medium"
                  >
                    {list.isFetchingNextPage ? 'جارٍ التحميل…' : 'المزيد'}
                  </button>
                </div>
              ) : null
            }
          />
          {list.isError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              تعذّر تحميل الطلبات، حاول مرة ثانية.
            </p>
          )}
        </div>
        {selectedId && (
          <OrderDetailPanel
            key={selectedId}
            orderId={selectedId}
            drivers={drivers.data ?? []}
            onClose={() => setParams({ order: null })}
          />
        )}
      </div>
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="text-text-muted"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
