'use client';
// التقارير والأرباح (أدمن، SPEC-admin §2.5، تصميم "Reports"). كل رقم من دوال قاعدة البيانات (report_*)؛
// الصفحة لا تجمع شيئاً. الكميات بالكيلو لنص الكيلو أو بالوحدة (formatAdminQuantity، §2.9).
import { errorMessage, formatAdminQuantity, formatIQD } from '@mukhdar/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { CashReportSection } from '@/features/cash/CashReportSection';
import { baghdadToday } from '@/features/orders/filters';
import { fetchReport, reportKeys, type ReportData, type ReportSummary } from './api';
import { chartGeometry, labelEvery } from './chart';
import { csvFileName, dailyCsv, downloadCsv, wasteCsv } from './csv';
import {
  PRESETS,
  percent,
  presetRange,
  rangeError,
  rangeLabel,
  type DayRange,
  type RangePreset,
} from './range';

const WEEKDAY = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { weekday: 'long', timeZone: 'UTC' });
const chip = (active: boolean) =>
  `h-10 rounded-full border px-3.5 text-sm ${
    active ? 'border-primary bg-primary font-semibold text-white' : 'border-border bg-surface'
  }`;
const card = 'flex flex-col gap-2.5 rounded-card border border-border bg-surface p-[18px]';

export function ReportsScreen() {
  const { supabase } = usePanel();
  const today = baghdadToday();
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [range, setRange] = useState<DayRange>(() => presetRange('7d', today));
  const [custom, setCustom] = useState<DayRange>(range);
  const customError = preset === 'custom' ? rangeError(custom) : null;

  const report = useQuery({
    queryKey: reportKeys.range(range),
    queryFn: () => fetchReport(supabase, range),
    placeholderData: keepPreviousData,
    // أرقام مالية: كل تغيير مدى يعيد الطلب (القديم يبقى ظاهراً حتى يصل الجديد)
    staleTime: 0,
  });
  const data = report.data;

  const pick = (p: Exclude<RangePreset, 'custom'>) => {
    setPreset(p);
    setRange(presetRange(p, today));
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-[26px] font-bold">التقارير والأرباح</h1>
          <span className="num text-[13px] text-text-muted" data-testid="report-range" dir="auto">
            {rangeLabel(range)} (بتوقيت بغداد)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="الفترة" className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={preset === p.id}
                onClick={() => pick(p.id)}
                className={chip(preset === p.id)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={preset === 'custom'}
              onClick={() => {
                setPreset('custom');
                setCustom(range);
              }}
              className={chip(preset === 'custom')}
            >
              مخصص
            </button>
          </div>
          <button
            type="button"
            disabled={!data}
            onClick={() =>
              data &&
              downloadCsv(
                csvFileName('daily', range.from, range.to),
                dailyCsv(data.daily, data.summary),
              )
            }
            className="flex h-10 items-center gap-1.5 rounded-control border border-border bg-surface px-3.5 text-sm disabled:opacity-50"
          >
            <DownloadIcon />
            تصدير CSV
          </button>
        </div>
      </header>

      {preset === 'custom' && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!customError) setRange(custom);
          }}
        >
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            من
            <input
              type="date"
              value={custom.from}
              max={today}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              className="num h-10 rounded-control border border-border px-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            إلى
            <input
              type="date"
              value={custom.to}
              max={today}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              className="num h-10 rounded-control border border-border px-2"
            />
          </label>
          <button
            type="submit"
            disabled={Boolean(customError)}
            className="h-10 rounded-control bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            عرض
          </button>
          {customError && (
            <span role="alert" className="text-xs text-danger">
              {customError}
            </span>
          )}
        </form>
      )}

      {report.error && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {errorMessage(report.error)}
        </p>
      )}
      {!data && report.isPending && <p className="text-text-muted">جارٍ التحميل…</p>}

      {data && (
        <div
          className={`flex flex-col gap-4 ${report.isFetching ? 'opacity-70' : ''}`}
          aria-busy={report.isFetching}
        >
          <Kpis s={data.summary} />
          <DailyChart data={data} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
            <TopProducts data={data} />
            <Drivers data={data} />
          </div>
          <WasteReport data={data} range={range} />
          <CashReportSection range={range} />
          <Comments data={data} />
        </div>
      )}
    </div>
  );
}

function DownloadIcon() {
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
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

function Kpis({ s }: { s: ReportSummary }) {
  const cancelledShare = percent(s.cancelled_count, s.placed_count);
  const items: { id: string; label: string; value: string; note: string; tone?: string }[] = [
    {
      id: 'placed',
      label: 'الطلبات الواردة',
      value: String(s.placed_count),
      note: 'كل الحالات، بوقت الطلب',
    },
    {
      id: 'delivered',
      label: 'طلبات مسلّمة',
      value: String(s.delivered_count),
      note: 'بيوم التسليم',
    },
    {
      id: 'cancelled',
      label: 'طلبات ملغاة',
      value: String(s.cancelled_count),
      note: cancelledShare ? `${cancelledShare} من الطلبات الواردة` : 'بيوم الإلغاء',
      tone: 'text-danger',
    },
    { id: 'sales', label: 'المبيعات', value: formatIQD(s.sales_iqd), note: 'بدون أجور التوصيل' },
    {
      id: 'fees',
      label: 'أجور التوصيل',
      value: formatIQD(s.delivery_fees_iqd),
      note: 'تروح للسواق (للعلم)',
      tone: 'text-text-muted',
    },
    {
      id: 'cost',
      label: 'التكلفة',
      value: formatIQD(s.cost_iqd),
      note: 'سعر الشراء وقت الطلب',
      tone: 'text-text-muted',
    },
    {
      id: 'gross',
      label: 'الربح الإجمالي',
      value: formatIQD(s.gross_profit_iqd),
      note: 'المبيعات ناقص التكلفة',
      tone: 'text-primary',
    },
    {
      id: 'waste',
      label: 'كلفة الهدر',
      value: formatIQD(s.waste_cost_iqd),
      note: 'ومنه الإلغاء بلا إرجاع',
      tone: 'text-warning-text',
    },
    {
      id: 'shortage',
      label: 'خسارة تسويات الجرد',
      value: formatIQD(s.adjust_loss_iqd),
      note: 'التسويات السالبة فقط',
      tone: 'text-warning-text',
    },
    {
      id: 'net',
      label: 'صافي الربح',
      value: formatIQD(s.net_profit_iqd),
      note: 'الإجمالي ناقص الهدر والنقص',
      tone: s.net_profit_iqd < 0 ? 'text-danger' : 'text-primary',
    },
    {
      id: 'avg',
      label: 'متوسط الطلب',
      value: s.avg_order_iqd === null ? '—' : formatIQD(s.avg_order_iqd),
      note: 'قبل التوصيل',
    },
  ];
  return (
    <section
      aria-label="المؤشرات"
      className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3"
    >
      {items.map((k) => (
        <div
          key={k.id}
          data-testid={`kpi-${k.id}`}
          className="flex flex-col gap-1.5 rounded-card border border-border bg-surface p-4"
        >
          <span className="text-[13px] text-text-muted">{k.label}</span>
          <span
            className={`num text-2xl font-bold ${k.tone ?? ''}`}
            data-testid={`kpi-${k.id}-value`}
          >
            {k.value}
          </span>
          <span className="text-xs text-text-muted">{k.note}</span>
        </div>
      ))}
    </section>
  );
}

function dayLabel(day: string, count: number): string {
  return count <= 7 ? WEEKDAY.format(new Date(`${day}T12:00:00Z`)) : day.slice(5);
}

function DailyChart({ data }: { data: ReportData }) {
  const geo = chartGeometry(data.daily);
  const every = labelEvery(geo.bars.length);
  const n = geo.bars.length;
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  return (
    <section aria-labelledby="chart-title" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="chart-title" className="m-0 text-[17px] font-bold">
          المبيعات وصافي الربح يومياً
        </h2>
        <div className="flex gap-3.5 text-[13px]">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[3px] bg-chart-sales" aria-hidden="true" />
            المبيعات
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[3px] bg-primary" aria-hidden="true" />
            صافي الربح
          </span>
        </div>
      </div>
      <div
        role="img"
        aria-label={`رسم يومي للمبيعات وصافي الربح، ${n} يوم. القيم بالجدول أدناه`}
        className="relative h-[220px]"
        data-testid="daily-chart"
      >
        <div
          className="absolute inset-x-0 border-t border-border"
          style={{ top: `${geo.zeroPct}%` }}
        />
        <div className="absolute inset-0 grid gap-[2px]" style={cols}>
          {geo.bars.map((b, i) => {
            const d = data.daily[i];
            const tip = d
              ? `${d.day}\nالمبيعات: ${formatIQD(d.sales_iqd)}\nصافي الربح: ${formatIQD(d.net_profit_iqd)}`
              : b.day;
            return (
              <div key={b.day} title={tip} className="relative h-full hover:bg-background">
                <div
                  className="absolute inset-x-[12%] flex justify-center gap-[2px]"
                  style={{ top: 0, height: `${geo.zeroPct}%` }}
                >
                  <div className="flex h-full w-1/2 max-w-7 items-end">
                    <div
                      className="w-full rounded-t-[4px] bg-chart-sales"
                      style={{ height: `${(b.salesPct / (geo.zeroPct || 1)) * 100}%` }}
                    />
                  </div>
                  <div className="flex h-full w-1/2 max-w-7 items-end">
                    {!b.netNegative && (
                      <div
                        className="w-full rounded-t-[4px] bg-primary"
                        style={{ height: `${(b.netPct / (geo.zeroPct || 1)) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
                {b.netNegative && (
                  <div
                    className="absolute inset-x-[12%] flex justify-center gap-[2px]"
                    style={{ top: `${geo.zeroPct}%`, height: `${b.netPct}%` }}
                  >
                    <div className="w-1/2 max-w-7" />
                    <div className="h-full w-1/2 max-w-7 rounded-b-[4px] bg-primary" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="grid gap-[2px] text-center text-xs text-text-muted"
        style={cols}
        aria-hidden="true"
      >
        {geo.bars.map((b, i) => (
          <span key={b.day} className="num whitespace-nowrap">
            {i % every === 0 ? dayLabel(b.day, n) : ''}
          </span>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-primary">عرض كجدول</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="daily-table">
            <thead>
              <tr className="bg-background text-right text-text-muted">
                {[
                  'اليوم',
                  'الواردة',
                  'المسلّمة',
                  'الملغاة',
                  'المبيعات',
                  'الكلفة',
                  'الهدر',
                  'النقص',
                  'صافي الربح',
                ].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.day} className="num border-t border-divider">
                  <td className="px-2 py-1.5">{d.day}</td>
                  <td className="px-2">{d.placed_count}</td>
                  <td className="px-2">{d.delivered_count}</td>
                  <td className="px-2">{d.cancelled_count}</td>
                  <td className="px-2">{formatIQD(d.sales_iqd)}</td>
                  <td className="px-2">{formatIQD(d.cost_iqd)}</td>
                  <td className="px-2">{formatIQD(d.waste_cost_iqd)}</td>
                  <td className="px-2">{formatIQD(d.adjust_loss_iqd)}</td>
                  <td className="px-2">{formatIQD(d.net_profit_iqd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function TopProducts({ data }: { data: ReportData }) {
  const max = Math.max(1, ...data.top.map((t) => t.sales_iqd));
  return (
    <section aria-labelledby="top-title" className={card} data-testid="top-products">
      <h2 id="top-title" className="m-0 text-[17px] font-bold">
        أكثر المنتجات مبيعاً
      </h2>
      {data.top.length === 0 && (
        <span className="text-sm text-text-muted">لا مبيعات بهذه الفترة</span>
      )}
      {data.top.map((t) => (
        <div
          key={`${t.product_id}-${t.unit}`}
          className="flex flex-col gap-1"
          data-product={t.name}
        >
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="font-semibold">{t.name}</span>
            <span className="num">
              {formatAdminQuantity(t.qty, t.unit)} · {formatIQD(t.sales_iqd)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-divider">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(t.sales_iqd / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}

function Drivers({ data }: { data: ReportData }) {
  const s = data.summary;
  return (
    <section aria-labelledby="drivers-title" className={card} data-testid="drivers">
      <h2 id="drivers-title" className="m-0 text-[17px] font-bold">
        السواق
      </h2>
      {data.drivers.length === 0 && (
        <span className="text-sm text-text-muted">لا توصيل بهذه الفترة</span>
      )}
      {data.drivers.map((d) => (
        <div
          key={d.driver_id ?? 'none'}
          className="flex min-h-11 items-center gap-2.5 border-b border-divider"
        >
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-primary-soft font-bold text-primary">
            {(d.name ?? '؟').trim().charAt(0) || '؟'}
          </span>
          <span className="flex-1 font-semibold">{d.name ?? 'حساب محذوف'}</span>
          <span className="num text-sm">
            {d.delivered_count} طلب · {formatIQD(d.delivery_fees_iqd)}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1.5" data-testid="rating-summary">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          className="fill-star stroke-star"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
        </svg>
        <span className="num text-[15px] font-bold">
          {s.rating_avg === null ? '—' : s.rating_avg.toFixed(1)}
        </span>
        <span className="text-[13px] text-text-muted">متوسط التقييم من {s.rating_count} تقييم</span>
      </div>
    </section>
  );
}

function WasteReport({ data, range }: { data: ReportData; range: DayRange }) {
  return (
    <section aria-labelledby="waste-title" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="waste-title" className="m-0 text-[17px] font-bold">
          تقرير الهدر ونقص الجرد
        </h2>
        <button
          type="button"
          disabled={data.waste.length === 0}
          onClick={() =>
            downloadCsv(csvFileName('waste', range.from, range.to), wasteCsv(data.waste))
          }
          className="flex h-10 items-center gap-1.5 rounded-control border border-border bg-surface px-3.5 text-sm disabled:opacity-50"
        >
          <DownloadIcon />
          تصدير الهدر CSV
        </button>
      </div>
      {data.waste.length === 0 ? (
        <span className="text-sm text-text-muted">لا هدر ولا نقص بهذه الفترة</span>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[560px] border-collapse text-sm"
            data-testid="waste-report"
          >
            <thead>
              <tr className="bg-background text-right text-text-muted">
                {['المنتج', 'الهدر', 'كلفة الهدر', 'نقص الجرد', 'كلفة النقص', 'المجموع'].map(
                  (h) => (
                    <th key={h} scope="col" className="px-3 py-2.5 font-semibold">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.waste.map((w) => (
                <tr key={w.product_id} data-product={w.name} className="border-t border-divider">
                  <td className="px-3 py-2 font-semibold">{w.name}</td>
                  <td className="num px-3" data-testid="waste-qty">
                    {formatAdminQuantity(w.waste_qty, w.unit)}
                  </td>
                  <td className="num px-3">{formatIQD(w.waste_cost_iqd)}</td>
                  <td className="num px-3">{formatAdminQuantity(w.shortage_qty, w.unit)}</td>
                  <td className="num px-3">{formatIQD(w.shortage_cost_iqd)}</td>
                  <td className="num px-3 font-semibold text-warning-text">
                    {formatIQD(w.total_cost_iqd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Comments({ data }: { data: ReportData }) {
  return (
    <section aria-labelledby="comments-title" className={card}>
      <h2 id="comments-title" className="m-0 text-[17px] font-bold">
        آخر التعليقات
      </h2>
      {data.comments.length === 0 && (
        <span className="text-sm text-text-muted">لا تعليقات بهذه الفترة</span>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {data.comments.map((c) => (
          <li key={c.order_id} className="flex flex-col gap-0.5 border-b border-divider pb-2">
            <span className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
              <span className="text-star" aria-label={`${c.stars} من 5`}>
                {'★'.repeat(c.stars)}
                <span className="text-border">{'★'.repeat(5 - c.stars)}</span>
              </span>
              {c.order_number !== null && (
                <a className="num" href={`/orders?order=${c.order_id}`}>
                  #{c.order_number}
                </a>
              )}
              <span className="num">{baghdadToday(new Date(c.created_at))}</span>
            </span>
            <span className="whitespace-pre-wrap text-sm">
              <bdi>{c.comment}</bdi>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
