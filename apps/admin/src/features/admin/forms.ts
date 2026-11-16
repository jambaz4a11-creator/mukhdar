// منطق نماذج T19 بلا واجهة (يُختبر بـ vitest): تحليل أرقام العمارات بالجملة، ونموذج الإعدادات.
import { normalizePin } from '@mukhdar/shared';

export const MAX_BUILDINGS_PER_ADD = 500;
export const MAX_BUILDING_NUMBER = 9999;

export interface BuildingParse {
  /** أرقام فريدة مرتبة تصاعدياً (نصاً، كما تُخزن بـ buildings.number). */
  numbers: string[];
  /** رسالة الخطأ الأولى، أو null. */
  error: string | null;
}

/**
 * "1-100" أو "1,2,5-9" أو أسطر/مسافات، بأرقام لاتينية أو عربية وفاصلة عربية "،".
 * المكرر يُحذف. الخطأ: جزء غير رقمي، رقم خارج 1..9999، مدى مقلوب، أو أكثر من 500 رقم.
 */
export function parseBuildingNumbers(input: string): BuildingParse {
  // التقسيم أولاً (المسافات فواصل)، ثم تحويل الأرقام العربية لكل جزء (normalizePin يحذف المسافات)
  const spaced = input
    .replace(/\s*[-–—]\s*/g, '-')
    .split(/[\s,،؛;]+/)
    .filter(Boolean)
    .map((p) => normalizePin(p));
  if (spaced.length === 0)
    return { numbers: [], error: 'اكتب أرقام العمارات، مثل 1-100 أو 1,2,5-9' };
  const set = new Set<number>();
  for (const part of spaced) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    const single = /^\d+$/.test(part);
    if (!range && !single) return { numbers: [], error: `"${part}" ليس رقماً أو مدى صحيحاً` };
    const from = Number(range ? range[1] : part);
    const to = Number(range ? range[2] : part);
    if (from < 1 || to > MAX_BUILDING_NUMBER || from > MAX_BUILDING_NUMBER || to < 1) {
      return { numbers: [], error: `الأرقام من 1 إلى ${MAX_BUILDING_NUMBER}` };
    }
    if (from > to) return { numbers: [], error: `المدى "${part}" مقلوب، اكتب الأصغر أولاً` };
    if (to - from + 1 > MAX_BUILDINGS_PER_ADD) {
      return { numbers: [], error: `حد أقصى ${MAX_BUILDINGS_PER_ADD} عمارة بالمرة` };
    }
    for (let n = from; n <= to; n++) set.add(n);
    if (set.size > MAX_BUILDINGS_PER_ADD) {
      return { numbers: [], error: `حد أقصى ${MAX_BUILDINGS_PER_ADD} عمارة بالمرة` };
    }
  }
  return { numbers: [...set].sort((a, b) => a - b).map(String), error: null };
}

/** معاينة: الأرقام الجديدة والموجودة أصلاً بالوحدة (تُتجاهل). */
export function splitNew(numbers: readonly string[], existing: Iterable<string>) {
  const have = new Set(existing);
  return {
    fresh: numbers.filter((n) => !have.has(n)),
    duplicates: numbers.filter((n) => have.has(n)),
  };
}

/** "1-5، 8، 10-12" لعرض قائمة طويلة باختصار. */
export function compactRanges(numbers: readonly string[]): string {
  const nums = numbers.map(Number).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === (nums[j] as number) + 1) j++;
    parts.push(i === j ? String(nums[i]) : `${nums[i]}-${nums[j]}`);
    i = j + 1;
  }
  return parts.join('، ');
}

// ---------------------------------------------------------------- الإعدادات

export interface SettingsValues {
  delivery_fee_iqd: string;
  min_order_iqd: string;
  max_active_orders: string;
  store_open: boolean;
  closed_message: string;
}

export interface SettingsPayload {
  delivery_fee_iqd: number;
  min_order_iqd: number;
  max_active_orders: number;
  store_open: boolean;
  closed_message: string | null;
}

export type SettingsErrors = Partial<Record<keyof SettingsValues, string>>;

function amount(raw: string): number | null {
  const s = normalizePin(raw).replace(/,/g, '');
  return /^\d{1,8}$/.test(s) ? Number(s) : null;
}

export function validateSettings(
  v: SettingsValues,
): { payload: SettingsPayload; errors: null } | { payload: null; errors: SettingsErrors } {
  const errors: SettingsErrors = {};
  const fee = amount(v.delivery_fee_iqd);
  if (fee === null) errors.delivery_fee_iqd = 'اكتب مبلغاً بالدينار';
  else if (fee % 250 !== 0) errors.delivery_fee_iqd = 'لازم يكون من مضاعفات 250';
  const min = amount(v.min_order_iqd);
  if (min === null) errors.min_order_iqd = 'اكتب مبلغاً بالدينار (0 = بلا حد)';
  else if (min % 250 !== 0) errors.min_order_iqd = 'لازم يكون من مضاعفات 250 (مثلاً 1000 أو 1250)';
  const maxRaw = normalizePin(v.max_active_orders);
  const max = /^\d{1,4}$/.test(maxRaw) ? Number(maxRaw) : null;
  if (max === null || max < 1 || max > 1000) errors.max_active_orders = 'عدد من 1 إلى 1000';
  const message = v.closed_message.trim();
  if (message.length > 200) errors.closed_message = 'الرسالة أطول من 200 حرف';
  if (Object.keys(errors).length > 0) return { payload: null, errors };
  return {
    payload: {
      delivery_fee_iqd: fee as number,
      min_order_iqd: min as number,
      max_active_orders: max as number,
      store_open: v.store_open,
      closed_message: message || null,
    },
    errors: null,
  };
}

// ---------------------------------------------------------------- الموظفون

export type UserRole = 'customer' | 'driver' | 'staff' | 'admin';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'أدمن',
  staff: 'موظف',
  driver: 'سائق',
  customer: 'زبون',
};

export function pinMessage(kind: 'reset' | 'create', pin: string): string {
  return kind === 'reset'
    ? `رمز دخولك الجديد بالمخضر: ${pin}، غيّره من حسابي`
    : `حسابك بالمخضر جاهز. رمزك المؤقت: ${pin}، غيّره من حسابي`;
}
