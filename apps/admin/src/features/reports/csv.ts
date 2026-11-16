// تصدير CSV للتقارير (SPEC-admin §2.5): المؤشرات اليومية وتقرير الهدر. الكميات بالكيلو لنص الكيلو أو
// بالوحدة، مع عمود الوحدة (عبر adminUnits فقط). المبالغ أعداد صحيحة بالدينار بلا فواصل آلاف.
// صف المجموع من report_summary (محسوب بقاعدة البيانات)، لا جمع بالمتصفح. BOM حتى يقرأ Excel العربية.
import { adminUnitLabel, toAdminQty } from '@mukhdar/shared';
import type { DailyRow, ReportSummary, WasteRow } from './api';

/** Byte-order mark: Excel يقرأ الملف UTF-8 (العربية) فقط معه. */
export const BOM = String.fromCharCode(0xfeff);

type Cell = string | number | null;

/** نص يبدأ بأحد هذه يُفسَّر صيغة بـ Excel/LibreOffice (L1 مراجعة C، OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** يمنع تفسير نص كصيغة بإضافة ' قبله. الأرقام (number) لا تُمس: صافي ربح سالب يبقى رقماً. */
export function csvText(v: string): string {
  return FORMULA_START.test(v) ? `'${v}` : v;
}

export function cell(v: Cell): string {
  if (v === null) return '';
  const s = typeof v === 'string' ? csvText(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return `${BOM}${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

export const DAILY_HEADER = [
  'اليوم',
  'الطلبات الواردة',
  'المسلّمة',
  'الملغاة',
  'المبيعات (بدون التوصيل)',
  'أجور التوصيل',
  'الكلفة',
  'الربح الإجمالي',
  'كلفة الهدر',
  'خسارة تسويات الجرد',
  'صافي الربح',
] as const;

export function dailyCsv(days: readonly DailyRow[], total: ReportSummary): string {
  return toCsv([
    DAILY_HEADER,
    ...days.map((d) => [
      d.day,
      d.placed_count,
      d.delivered_count,
      d.cancelled_count,
      d.sales_iqd,
      d.delivery_fees_iqd,
      d.cost_iqd,
      d.gross_profit_iqd,
      d.waste_cost_iqd,
      d.adjust_loss_iqd,
      d.net_profit_iqd,
    ]),
    [
      'المجموع',
      total.placed_count,
      total.delivered_count,
      total.cancelled_count,
      total.sales_iqd,
      total.delivery_fees_iqd,
      total.cost_iqd,
      total.gross_profit_iqd,
      total.waste_cost_iqd,
      total.adjust_loss_iqd,
      total.net_profit_iqd,
    ],
  ]);
}

export const WASTE_HEADER = [
  'المنتج',
  'الوحدة',
  'كمية الهدر',
  'كلفة الهدر',
  'كمية نقص الجرد',
  'كلفة نقص الجرد',
  'المجموع',
] as const;

export function wasteCsv(rows: readonly WasteRow[]): string {
  return toCsv([
    WASTE_HEADER,
    ...rows.map((r) => [
      r.name,
      adminUnitLabel(r.unit),
      toAdminQty(r.waste_qty, r.unit),
      r.waste_cost_iqd,
      toAdminQty(r.shortage_qty, r.unit),
      r.shortage_cost_iqd,
      r.total_cost_iqd,
    ]),
  ]);
}

export function csvFileName(kind: 'daily' | 'waste', from: string, to: string): string {
  return `mukhdar-${kind === 'daily' ? 'report' : 'waste'}-${from}_${to}.csv`;
}

/** تنزيل بالمتصفح. */
export function downloadCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
