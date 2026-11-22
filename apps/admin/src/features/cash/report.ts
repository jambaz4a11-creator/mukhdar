// تقرير الكاش والسواق (أدمن فقط، SPEC-cash K13). كل رقم من report_cash بقاعدة البيانات؛ هنا فحص الشكل
// والتصدير فقط، ولا جمع بالمتصفح. النقص والزيادة منفصلان (لا يلغي أحدهما الآخر).
import { toCsv } from '@/features/reports/csv';

export interface CashReportTotals {
  handover_count: number;
  expected_iqd: number;
  received_iqd: number;
  shortage_iqd: number;
  overage_iqd: number;
  net_difference_iqd: number;
  /** R4 M1: أجور توصيل بقت عند السواق (تسليمات سُجّلت بإعداد "تبقى عند السائق") بالمدى */
  fees_kept_iqd: number;
}

export interface CashReportDriver extends CashReportTotals {
  /** null = حساب محذوف */
  driver_id: string | null;
  full_name: string | null;
  held_now_iqd: number;
}

export interface CashReport {
  from: string;
  to: string;
  held_now_iqd: number;
  held_now_drivers: number;
  totals: CashReportTotals;
  drivers: CashReportDriver[];
}

const TOTAL_FIELDS = [
  'handover_count',
  'expected_iqd',
  'received_iqd',
  'shortage_iqd',
  'overage_iqd',
  'net_difference_iqd',
  'fees_kept_iqd',
] as const;

function checkTotals(v: unknown, extra: readonly string[] = []): void {
  if (!v || typeof v !== 'object') throw new Error('REPORT_SHAPE');
  const r = v as Record<string, unknown>;
  for (const k of [...TOTAL_FIELDS, ...extra]) {
    if (!Number.isSafeInteger(r[k])) throw new Error(`REPORT_SHAPE: ${k}`);
  }
}

/** يتحقق من شكل report_cash: المبالغ والأعداد صحيحة (لا كسور ولا نصوص)، وإلا خطأ. */
export function parseCashReport(raw: unknown): CashReport {
  if (!raw || typeof raw !== 'object') throw new Error('REPORT_SHAPE');
  const r = raw as Record<string, unknown>;
  for (const k of ['held_now_iqd', 'held_now_drivers']) {
    if (!Number.isSafeInteger(r[k])) throw new Error(`REPORT_SHAPE: ${k}`);
  }
  checkTotals(r.totals);
  if (!Array.isArray(r.drivers)) throw new Error('REPORT_SHAPE: drivers');
  for (const d of r.drivers) checkTotals(d, ['held_now_iqd']);
  return r as unknown as CashReport;
}

export const CASH_HEADER = [
  'السائق',
  'التسليمات',
  'المطلوب',
  'المستلم',
  'النقص',
  'الزيادة',
  'أجرة التوصيل عنده',
  'بيده الآن',
] as const;

/** مبالغ أعداد صحيحة بلا فواصل آلاف (CSV)، وصف "المجموع" من totals (محسوب بقاعدة البيانات). */
export function cashCsv(report: CashReport): string {
  return toCsv([
    CASH_HEADER,
    ...report.drivers.map((d) => [
      d.full_name ?? 'سائق محذوف',
      d.handover_count,
      d.expected_iqd,
      d.received_iqd,
      d.shortage_iqd,
      d.overage_iqd,
      d.fees_kept_iqd,
      d.held_now_iqd,
    ]),
    [
      'المجموع',
      report.totals.handover_count,
      report.totals.expected_iqd,
      report.totals.received_iqd,
      report.totals.shortage_iqd,
      report.totals.overage_iqd,
      report.totals.fees_kept_iqd,
      report.held_now_iqd,
    ],
  ]);
}

export function cashCsvFileName(from: string, to: string): string {
  return `mukhdar-cash-${from}_${to}.csv`;
}
