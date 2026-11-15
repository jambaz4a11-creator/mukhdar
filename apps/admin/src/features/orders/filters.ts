// تبويبات وفلاتر صفحة الطلبات (SPEC-admin §2.1). دوال صرفة: تُختبر بلا Supabase.
import { normalizeIraqiPhone, toStoredPhone, type OrderStatus } from '@mukhdar/shared';

/** بغداد UTC+3 طوال السنة (لا توقيت صيفي، SPEC-admin افتراض 10). */
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

export type OrdersTab =
  'pending' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';

export const TABS: readonly OrdersTab[] = [
  'pending',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
];

/** التبويبات بيوم محدد (المسلّم والملغي "اليوم" افتراضياً)؛ المفتوحة تعرض كل المفتوح الآن. */
export const DAY_TABS: readonly OrdersTab[] = ['delivered', 'cancelled'];

/** عمود اليوم لكل تبويب يومي. */
const DAY_COLUMN: Record<'delivered' | 'cancelled', 'delivered_at' | 'cancelled_at'> = {
  delivered: 'delivered_at',
  cancelled: 'cancelled_at',
};

export function tabLabel(tab: OrdersTab, day: string, today: string): string {
  const suffix = day === today ? 'اليوم' : day;
  switch (tab) {
    case 'pending':
      return 'جديد';
    case 'preparing':
      return 'قيد التحضير';
    case 'ready':
      return 'جاهز';
    case 'out_for_delivery':
      return 'بالطريق';
    case 'delivered':
      return `مسلّم ${suffix}`;
    case 'cancelled':
      return `ملغي ${suffix}`;
  }
}

/** "2026-11-16" ليوم بغداد الحالي. */
export function baghdadToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BAGHDAD_OFFSET_MS).toISOString().slice(0, 10);
}

export function isDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** حدود يوم بغداد كـ ISO UTC: [from, to). */
export function baghdadDayRange(day: string): { from: string; to: string } {
  const start = Date.parse(`${day}T00:00:00Z`) - BAGHDAD_OFFSET_MS;
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export type SearchTerm =
  | { kind: 'none' }
  | { kind: 'order_number'; value: number }
  | { kind: 'phone'; value: string }
  | { kind: 'invalid' };

/**
 * البحث: رقم هاتف عراقي (07…، +964…) ← `customer_phone` بالصيغة المخزنة 9647…؛ أو رقم طلب (مع # اختياري).
 * غير ذلك ← invalid (رسالة بدل استعلام فارغ).
 */
export function parseSearch(input: string): SearchTerm {
  const raw = input.trim();
  if (raw === '') return { kind: 'none' };
  const phone = normalizeIraqiPhone(raw);
  if (phone) return { kind: 'phone', value: toStoredPhone(phone) };
  const num = /^#?\s*(\d{1,9})$/.exec(raw)?.[1];
  if (num) return { kind: 'order_number', value: Number(num) };
  return { kind: 'invalid' };
}

export interface OrdersFilters {
  tab: OrdersTab;
  /** يوم بغداد للتبويبات اليومية (افتراضياً اليوم)، أو يوم الإنشاء (اختياري) للمفتوحة. */
  day: string | null;
  driverId: string | null;
  search: string;
}

/** شروط الاستعلام كبيانات (تُطبَّق على PostgREST بـ applyFilters). */
export interface QueryConditions {
  status: OrderStatus | null;
  range: {
    column: 'created_at' | 'delivered_at' | 'cancelled_at';
    from: string;
    to: string;
  } | null;
  driverId: string | null;
  orderNumber: number | null;
  phone: string | null;
}

/**
 * البحث يتجاوز التبويب واليوم (يجد الطلب بأي حالة وتاريخ)، ويبقى فلتر السائق.
 * التبويبات اليومية تستخدم عمود حالتها (`delivered_at`/`cancelled_at`)؛ المفتوحة `created_at` إن اختير يوم.
 */
export function conditionsFor(filters: OrdersFilters, today: string): QueryConditions | 'invalid' {
  const search = parseSearch(filters.search);
  if (search.kind === 'invalid') return 'invalid';
  const base = { driverId: filters.driverId, orderNumber: null, phone: null };
  if (search.kind === 'order_number')
    return { ...base, status: null, range: null, orderNumber: search.value };
  if (search.kind === 'phone') return { ...base, status: null, range: null, phone: search.value };

  const tab = filters.tab;
  if (tab === 'delivered' || tab === 'cancelled') {
    const day = isDay(filters.day) ? filters.day : today;
    return { ...base, status: tab, range: { column: DAY_COLUMN[tab], ...baghdadDayRange(day) } };
  }
  const range = isDay(filters.day)
    ? { column: 'created_at' as const, ...baghdadDayRange(filters.day) }
    : null;
  return { ...base, status: tab, range };
}

/** مؤشر الصفحة التالية (keyset على created_at ثم id، تنازلياً). */
export interface Cursor {
  created_at: string;
  id: string;
}

/** شرط PostgREST `or` للصفوف بعد المؤشر: أقدم، أو نفس الوقت وid أصغر. */
export function keysetFilter(cursor: Cursor): string {
  const t = `"${cursor.created_at}"`;
  return `created_at.lt.${t},and(created_at.eq.${t},id.lt.${cursor.id})`;
}

export function parseTab(value: string | null | undefined): OrdersTab {
  return (TABS as readonly string[]).includes(value ?? '') ? (value as OrdersTab) : 'pending';
}
