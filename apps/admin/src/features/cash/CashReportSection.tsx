'use client';
// قسم "الكاش والسواق" بالتقارير (أدمن فقط، SPEC-cash K13، SPEC-admin §2.5): الكاش عند السواق الآن، والنقص والزيادة
// بالمدى (منفصلان)، وجدول لكل سائق مع تصدير CSV. كل رقم من report_cash؛ لا جمع بالمتصفح. استعلامه مستقل
// فلا يُسقط فشلُه باقي التقارير.
import { errorMessage, formatIQD } from '@mukhdar/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { usePanel } from '@/components/PanelProviders';
import { downloadCsv } from '@/features/reports/csv';
import type { DayRange } from '@/features/reports/range';
import { cashKeys, fetchCashReport } from './api';
import { cashCsv, cashCsvFileName } from './report';

const card = 'flex flex-col gap-2.5 rounded-card border border-border bg-surface p-[18px]';

export function CashReportSection({ range }: { range: DayRange }) {
  const { supabase } = usePanel();
  const q = useQuery({
    queryKey: cashKeys.report(range.from, range.to),
    queryFn: () => fetchCashReport(supabase, range),
    placeholderData: keepPreviousData,
    staleTime: 0, // أرقام مالية
  });
  const data = q.data;

  const tiles = data
    ? [
        {
          id: 'held',
          label: 'الكاش عند السواق الآن',
          value: formatIQD(data.held_now_iqd),
          note: `${data.held_now_drivers} سائق`,
          tone: 'text-primary',
        },
        {
          id: 'shortage',
          label: 'النقص بالمدة',
          value: formatIQD(data.totals.shortage_iqd),
          note: 'مجموع النواقص بالتسليمات',
          tone: 'text-danger',
        },
        {
          id: 'overage',
          label: 'الزيادة بالمدة',
          value: formatIQD(data.totals.overage_iqd),
          note: 'مجموع الزيادات (لا يلغي النقص)',
          tone: 'text-warning-text',
        },
        {
          // R4 M1: أجور توصيل ما انطلبت من السواق (تسليمات بإعداد "أجرة التوصيل تبقى عند السائق")
          id: 'fees-kept',
          label: 'أجرة التوصيل عند السواق',
          value: formatIQD(data.totals.fees_kept_iqd),
          note: 'أجور ما انطلبت بالتسليم (الإعداد: تبقى عند السائق)',
          tone: 'text-text',
        },
      ]
    : [];

  return (
    <section aria-labelledby="cash-title" className={card} data-testid="cash-report">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cash-title" className="m-0 text-[17px] font-bold">
          الكاش والسواق
        </h2>
        <button
          type="button"
          disabled={!data || data.drivers.length === 0}
          onClick={() => data && downloadCsv(cashCsvFileName(range.from, range.to), cashCsv(data))}
          className="flex h-10 items-center gap-1.5 rounded-control border border-border bg-surface px-3.5 text-sm disabled:opacity-50"
        >
          تصدير الكاش CSV
        </button>
      </div>
      {q.error && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {errorMessage(q.error)}
        </p>
      )}
      {!data && q.isPending && <span className="text-sm text-text-muted">جارٍ التحميل…</span>}
      {data && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            {tiles.map((t) => (
              <div
                key={t.id}
                data-testid={`cash-kpi-${t.id}`}
                className="flex flex-col gap-1 rounded-card border border-border p-4"
              >
                <span className="text-[13px] text-text-muted">{t.label}</span>
                <span
                  className={`num text-2xl font-bold ${t.tone}`}
                  data-testid={`cash-kpi-${t.id}-value`}
                >
                  {t.value}
                </span>
                <span className="num text-xs text-text-muted">{t.note}</span>
              </div>
            ))}
          </div>
          {data.drivers.length === 0 ? (
            <span className="text-sm text-text-muted">لا تسليمات ولا كاش عند السواق</span>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="w-full min-w-[640px] border-collapse text-sm"
                data-testid="cash-report-table"
              >
                <thead>
                  <tr className="bg-background text-right text-text-muted">
                    {[
                      'السائق',
                      'التسليمات',
                      'المطلوب',
                      'المستلم',
                      'النقص',
                      'الزيادة',
                      'أجرة التوصيل عنده',
                      'بيده الآن',
                    ].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2.5 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.drivers.map((d) => (
                    <tr
                      key={d.driver_id ?? 'deleted'}
                      data-driver-name={d.full_name ?? ''}
                      className="border-t border-divider"
                    >
                      <td className="px-3 py-2 font-semibold">{d.full_name ?? 'سائق محذوف'}</td>
                      <td className="num px-3">{d.handover_count}</td>
                      <td className="num px-3">{formatIQD(d.expected_iqd)}</td>
                      <td className="num px-3">{formatIQD(d.received_iqd)}</td>
                      <td className="num px-3 text-danger">{formatIQD(d.shortage_iqd)}</td>
                      <td className="num px-3 text-warning-text">{formatIQD(d.overage_iqd)}</td>
                      <td className="num px-3">{formatIQD(d.fees_kept_iqd)}</td>
                      <td className="num px-3 font-semibold">{formatIQD(d.held_now_iqd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
