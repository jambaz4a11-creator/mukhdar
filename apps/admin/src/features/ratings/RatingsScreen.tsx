'use client';
// التقييمات (T26، SPEC-admin §2.8، تصميم "التقييمات" المعتمد): المتوسط والعدد والتوزيع من ratings_summary،
// والقائمة من ratings_list (keyset 50). الفلاتر بالرابط وتُطبَّق على الرأس والقائمة معاً (نفس المعاملات).
// التعليق يُعرض نصاً صرفاً (React يهرّب كل شيء؛ لا dangerouslySetInnerHTML).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePanel } from '@/components/PanelProviders';
import { isDay } from '@/features/orders/filters';
import { useUrlParams } from '@/lib/urlParams';
import { fetchRatingsPage, fetchRatingsSummary, ratingsKeys, type RatingRow } from './api';
import {
  PRESETS,
  barColor,
  barPercent,
  filledStars,
  formatRatingDate,
  parsePreset,
  validRange,
  type RatingFilters,
} from './filters';

const POLL_MS = 60_000;
const RATINGS_URL_DEFAULTS = { f: 'all' };
const STAR_PATH = 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z';
const BAR: Record<'primary' | 'star' | 'danger', string> = {
  primary: 'bg-primary',
  star: 'bg-star',
  danger: 'bg-danger',
};
const chip = (active: boolean) =>
  `h-10 rounded-full border px-3.5 text-sm ${
    active ? 'border-primary bg-primary font-semibold text-white' : 'border-border bg-surface'
  }`;
const card = 'rounded-card border border-border bg-surface';

export function RatingsScreen() {
  const { supabase, role } = usePanel();
  const params = useSearchParams();

  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const from = rawFrom && isDay(rawFrom) ? rawFrom : null;
  const to = rawTo && isDay(rawTo) ? rawTo : null;
  const rangeOk = validRange(from, to);
  const filters: RatingFilters = {
    preset: parsePreset(params.get('f')),
    from: rangeOk ? from : null,
    to: rangeOk ? to : null,
  };

  // يقرأ الرابط لحظة الاستدعاء (lib/urlParams، M2): تعبئة "من" ثم "إلى" بسرعة لا تُسقط الأولى
  const setParams = useUrlParams(RATINGS_URL_DEFAULTS);

  const summary = useQuery({
    queryKey: ratingsKeys.summary(filters),
    queryFn: () => fetchRatingsSummary(supabase, filters),
    refetchInterval: POLL_MS,
  });
  const list = useInfiniteQuery({
    queryKey: ratingsKeys.list(filters),
    queryFn: ({ pageParam }) => fetchRatingsPage(supabase, filters, pageParam),
    initialPageParam: null as { created_at: string; order_id: string } | null,
    getNextPageParam: (last) => last.next,
    // لا استطلاع للقائمة (L6): TanStack كان يعيد جلب كل الصفحات المحمّلة تباعاً كل دقيقة.
    // الرأس وحده يُستطلع، والقائمة تُحدَّث فقط عندما يتغير العدد (تقييم جديد).
  });

  const s = summary.data;
  const filterKey = JSON.stringify(filters);
  const seen = useRef<{ key: string; count: number } | null>(null);
  const refetchList = list.refetch;
  useEffect(() => {
    if (s === undefined) return;
    const prev = seen.current;
    seen.current = { key: filterKey, count: s.count };
    if (prev && prev.key === filterKey && prev.count !== s.count) void refetchList();
  }, [s, filterKey, refetchList]);
  const rows: RatingRow[] = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const max = s ? Math.max(...Object.values(s.distribution)) : 0;
  const nowIso = new Date().toISOString();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="m-0 text-[26px] font-bold">التقييمات</h1>
      {role === 'staff' && (
        // T23 F M1: الموظف يرى تقييمات آخر 7 أيام (بغداد) فقط، مثل الطلبات؛ قاعدة البيانات تفرضها
        <p className="m-0 text-xs text-text-muted" data-testid="staff-window-note">
          تظهر لك تقييمات آخر 7 أيام فقط. الأقدم من ذلك عند المدير.
        </p>
      )}

      <div className="flex flex-wrap items-stretch gap-4">
        <section
          aria-label="المتوسط العام"
          className={`${card} flex flex-[1_1_240px] flex-col items-center justify-center gap-1.5 p-5 text-center`}
        >
          <span className="num text-5xl leading-none font-bold" data-testid="rating-avg">
            {s ? (s.avg === null ? '—' : s.avg.toFixed(1)) : '…'}
          </span>
          {s && (
            <span
              role="img"
              aria-label={s.avg === null ? 'بلا تقييمات' : `${s.avg.toFixed(1)} من 5 نجوم`}
              className="flex gap-0.5"
              dir="ltr"
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <svg
                  key={i}
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill={i <= filledStars(s.avg) ? '#E8A13A' : '#F6DDB3'}
                  stroke="#E8A13A"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={STAR_PATH} />
                </svg>
              ))}
            </span>
          )}
          <span className="text-sm text-text-muted">
            من{' '}
            <span className="num" data-testid="rating-count">
              {s?.count ?? '…'}
            </span>{' '}
            تقييم
          </span>
        </section>

        <section
          aria-label="توزيع النجوم"
          className={`${card} flex flex-[999_1_420px] flex-col gap-2.5 p-5`}
        >
          {([5, 4, 3, 2, 1] as const).map((n) => {
            const count = s?.distribution[String(n) as '1'] ?? 0;
            return (
              <div key={n} className="flex items-center gap-2.5 text-sm" data-testid={`dist-${n}`}>
                <span className="w-14 text-[#3A4237]">{n} نجوم</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-divider">
                  <span
                    className={`block h-full ${BAR[barColor(n)]}`}
                    style={{ width: `${barPercent(count, max)}%` }}
                  />
                </span>
                <span
                  className="num w-10 text-left font-semibold text-[#3A4237]"
                  data-testid={`dist-${n}-count`}
                >
                  {count}
                </span>
              </div>
            );
          })}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">فلترة:</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={filters.preset === p.id}
            onClick={() => setParams({ f: p.id })}
            className={chip(filters.preset === p.id)}
          >
            {p.label}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-sm">
          من
          <input
            type="date"
            value={rawFrom ?? ''}
            onChange={(e) => setParams({ from: e.target.value || null })}
            className="num h-10 rounded-control border border-border bg-surface px-2"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          إلى
          <input
            type="date"
            value={rawTo ?? ''}
            onChange={(e) => setParams({ to: e.target.value || null })}
            className="num h-10 rounded-control border border-border bg-surface px-2"
          />
        </label>
        {(rawFrom || rawTo) && (
          <button
            type="button"
            onClick={() => setParams({ from: null, to: null })}
            className="h-10 rounded-full px-3 text-sm font-semibold text-primary"
          >
            كل المدة
          </button>
        )}
      </div>
      {!rangeOk && (
        <p role="alert" className="m-0 text-sm text-danger">
          المدى غير صحيح: تاريخ "من" بعد "إلى".
        </p>
      )}

      {(summary.isError || list.isError) && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-card bg-danger-soft p-4 text-danger"
        >
          تعذّر تحميل التقييمات.
          <button
            type="button"
            onClick={() => {
              void summary.refetch();
              void list.refetch();
            }}
            className="min-h-11 rounded-control border border-danger px-4 font-semibold"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      <section
        aria-label="قائمة التقييمات"
        className="flex flex-col gap-2.5"
        data-testid="ratings-list"
      >
        {rows.map((r) => {
          const low = r.stars <= 3;
          return (
            <article
              key={r.order_id}
              data-order-number={r.order_number}
              data-stars={r.stars}
              className={`${card} flex flex-col gap-2 p-4`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2.5">
                  <span className="text-[15px] font-bold">
                    {r.customer_name === null ? 'زبون محذوف' : <bdi>{r.customer_name}</bdi>}
                  </span>
                  <span
                    className={`num rounded-full px-2.5 py-0.5 text-sm font-bold ${
                      low ? 'bg-danger-soft text-danger' : 'bg-[#FFF4E0] text-warning-text'
                    }`}
                  >
                    {r.stars} ★
                  </span>
                </span>
                <span className="flex items-center gap-3 text-[13px] text-text-muted">
                  <span className="num">{formatRatingDate(r.created_at, nowIso)}</span>
                  <Link
                    href={`/orders?order=${r.order_id}`}
                    className="num flex min-h-8 items-center font-semibold no-underline"
                  >
                    الطلب #{r.order_number}
                  </Link>
                </span>
              </div>
              {r.comment && (
                <p className="m-0 text-[15px] leading-[1.7] whitespace-pre-line text-[#3A4237]">
                  <bdi>{r.comment}</bdi>
                </p>
              )}
            </article>
          );
        })}
        {list.isPending && (
          <p role="status" className="text-sm text-text-muted">
            جارٍ التحميل…
          </p>
        )}
        {!list.isPending && rows.length === 0 && (
          <p role="status" className={`${card} p-8 text-center text-text-muted`}>
            ماكو تقييمات بهذا الفلتر.
          </p>
        )}
        {list.hasNextPage && (
          <button
            type="button"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
            className="h-11 self-center rounded-control border border-border bg-surface px-6 text-sm font-medium"
          >
            {list.isFetchingNextPage ? 'جارٍ التحميل…' : 'عرض المزيد'}
          </button>
        )}
      </section>
    </div>
  );
}
