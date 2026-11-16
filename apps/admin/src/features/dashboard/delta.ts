// مقارنة بطاقات الرئيسية بأمس (SPEC-admin §2.0). دوال صرفة: الأرقام من dashboard_today()، وهنا عرض الفرق فقط
// (لا جمع ولا حساب أرباح بالمتصفح).
import { formatIQD } from '@mukhdar/shared';

export type Tone = 'good' | 'bad' | 'flat';

export interface Delta {
  /** "▲ 12% عن أمس لنفس الساعة" أو "—" */
  text: string;
  tone: Tone;
}

export const SAME_HOUR = 'عن أمس لنفس الساعة';
const NO_DATA: Delta = { text: '—', tone: 'flat' };
const SAME: Delta = { text: 'مثل أمس لنفس الساعة', tone: 'flat' };

/**
 * نسبة التغيّر مقرّبة لأقرب 1%. أمس صفر (أو غائب) ← null (يُعرض "—" لا "∞%").
 * زيادة 12% ← 12، نقصان 3% ← -3.
 */
export function changePercent(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function arrow(diff: number): '▲' | '▼' {
  return diff > 0 ? '▲' : '▼';
}

/**
 * فرق بنسبة مئوية (المبيعات، متوسط الطلب). `inverse` للحالات التي النقصان فيها جيد.
 */
export function percentDelta(
  current: number,
  previous: number | null,
  label: string = SAME_HOUR,
  inverse = false,
): Delta {
  const pct = changePercent(current, previous);
  if (pct === null) return NO_DATA;
  if (pct === 0) return current === previous ? SAME : { text: `= 0% ${label}`, tone: 'flat' };
  return {
    text: `${arrow(pct)} ${Math.abs(pct)}% ${label}`,
    tone: pct > 0 !== inverse ? 'good' : 'bad',
  };
}

/** فرق بالعدد (الطلبات المسلّمة والملغاة والواردة): "▲ 5 عن أمس لنفس الساعة". الملغاة: النقصان جيد. */
export function countDelta(current: number, previous: number, inverse = false): Delta {
  const diff = current - previous;
  if (diff === 0) return SAME;
  return {
    text: `${arrow(diff)} ${Math.abs(diff)} ${SAME_HOUR}`,
    tone: diff > 0 !== inverse ? 'good' : 'bad',
  };
}

/** صافي الربح: أمس كاملاً (لا نفس الساعة)، "—" عند غياب بيانات أمس. */
export function netYesterday(previous: number | null): Delta {
  return {
    text: `أمس كامل: ${previous === null ? '—' : formatIQD(previous)}`,
    tone: 'flat',
  };
}
