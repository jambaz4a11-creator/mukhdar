// بطاقات الرئيسية بترتيب التصميم المعتمد. دوال صرفة تُختبر بلا واجهة. المال لا يصل للموظف من الدالة نفسها
// (null)، فبطاقاته لا تُبنى: لا مبلغ ولا "د.ع" بصفحته.
import { formatIQD } from '@mukhdar/shared';
import type { Dashboard } from './api';
import { countDelta, netYesterday, percentDelta, type Delta } from './delta';

export interface Kpi {
  id: string;
  label: string;
  /** من يراها: التصميم يعلّمها "للأدمن" أو "الكل" */
  tag: 'للأدمن' | 'الكل';
  value: string;
  valueClass?: string;
  delta: Delta;
  href?: string;
}

export function buildKpis(d: Dashboard): Kpi[] {
  const money = d.sales_iqd !== null;
  const kpis: Kpi[] = [];
  if (money && d.sales_iqd !== null) {
    kpis.push({
      id: 'sales',
      label: 'المبيعات',
      tag: 'للأدمن',
      value: formatIQD(d.sales_iqd),
      delta: percentDelta(d.sales_iqd, d.sales_prev_iqd),
    });
  }
  kpis.push(
    {
      id: 'delivered',
      label: 'طلبات مسلّمة',
      tag: 'الكل',
      value: String(d.delivered_count),
      delta: countDelta(d.delivered_count, d.delivered_count_prev),
    },
    {
      id: 'cancelled',
      label: 'طلبات ملغاة',
      tag: 'الكل',
      value: String(d.cancelled_count),
      valueClass: 'text-danger',
      delta: countDelta(d.cancelled_count, d.cancelled_count_prev, true),
    },
  );
  if (money && d.net_profit_iqd !== null) {
    kpis.push({
      id: 'net',
      label: 'صافي الربح',
      tag: 'للأدمن',
      value: formatIQD(d.net_profit_iqd),
      valueClass: d.net_profit_iqd < 0 ? 'text-danger' : 'text-primary',
      delta: netYesterday(d.net_profit_prev_iqd),
    });
  }
  kpis.push({
    id: 'placed',
    label: 'طلبات اليوم',
    tag: 'الكل',
    value: String(d.placed_count),
    delta: countDelta(d.placed_count, d.placed_count_prev),
  });
  if (money) {
    kpis.push({
      id: 'avg',
      label: 'متوسط الطلب',
      tag: 'للأدمن',
      value: d.avg_order_iqd === null ? '—' : formatIQD(d.avg_order_iqd),
      delta:
        d.avg_order_iqd === null
          ? { text: '—', tone: 'flat' }
          : percentDelta(d.avg_order_iqd, d.avg_order_prev_iqd),
    });
    if (d.waste_cost_iqd !== null) {
      kpis.push({
        id: 'waste',
        label: 'هدر اليوم',
        tag: 'للأدمن',
        value: formatIQD(d.waste_cost_iqd),
        valueClass: 'text-warning-text',
        delta: { text: 'بسعر الشراء', tone: 'flat' },
      });
    }
  }
  kpis.push({
    id: 'low',
    label: 'منتجات ناقصة',
    tag: 'الكل',
    value: String(d.low_stock_count),
    valueClass: 'text-warning-text',
    delta: { text: 'تحت حد التنبيه', tone: 'flat' },
    href: '/stock',
  });
  return kpis;
}
