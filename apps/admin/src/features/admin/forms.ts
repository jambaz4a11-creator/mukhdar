// منطق نماذج T19 بلا واجهة (يُختبر بـ vitest): تحليل أرقام العمارات بالجملة، ونموذج الإعدادات.
import { ERROR_MESSAGES, isErrorCode, normalizePin, parseBackendError } from '@mukhdar/shared';

/** عمارة 1..100 داخل كل وحدة (CLAUDE.md)؛ قاعدة البيانات تفرضها أيضاً (buildings_number_format). */
export const MAX_BUILDING_NUMBER = 100;
const BUILDING_NUMBER_RE = /^([1-9][0-9]?|100)$/;

/** رقم عمارة واحد (تعديل الاسم): رسالة الخطأ، أو null. الأرقام العربية تُحوَّل قبل الفحص. */
export function validateBuildingNumber(input: string): string | null {
  return BUILDING_NUMBER_RE.test(normalizePin(input))
    ? null
    : `رقم العمارة من 1 إلى ${MAX_BUILDING_NUMBER}`;
}

export interface BuildingParse {
  /** أرقام فريدة مرتبة تصاعدياً (نصاً، كما تُخزن بـ buildings.number). */
  numbers: string[];
  /** رسالة الخطأ الأولى، أو null. */
  error: string | null;
}

/**
 * "1-100" أو "1,2,5-9" أو أسطر/مسافات، بأرقام لاتينية أو عربية وفاصلة عربية "،".
 * المكرر يُحذف. الخطأ: جزء غير رقمي، رقم خارج 1..100، أو مدى مقلوب.
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
    for (let n = from; n <= to; n++) set.add(n);
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
  /** T23 H2: حد الطلبات المفتوحة لحساب بلا طلب مُسلَّم بعد (افتراضي 1) */
  new_account_max_active_orders: string;
  /** T23 H2: حد الكمية لكل منتج بالطلب (وحدات بيع، 20 = 10 كيلو للنص كيلو) */
  max_line_qty: string;
  /** T23 H2: حد عدد المنتجات بالطلب */
  max_order_lines: string;
  /** T23 F M3: أقصى مجموع للطلب (مع التوصيل) لكل زبون، افتراضي 200,000 */
  max_order_iqd: string;
  /** T23 F M3: أقصى مجموع لحساب بلا طلب مُسلَّم بعد، افتراضي 50,000 */
  new_account_max_order_iqd: string;
  store_open: boolean;
  closed_message: string;
}

export interface SettingsPayload {
  delivery_fee_iqd: number;
  min_order_iqd: number;
  max_active_orders: number;
  new_account_max_active_orders: number;
  max_line_qty: number;
  max_order_lines: number;
  max_order_iqd: number;
  new_account_max_order_iqd: number;
  store_open: boolean;
  closed_message: string | null;
}

export type SettingsErrors = Partial<Record<keyof SettingsValues, string>>;

function amount(raw: string): number | null {
  const s = normalizePin(raw).replace(/,/g, '');
  return /^\d{1,8}$/.test(s) ? Number(s) : null;
}

function intIn(raw: string, min: number, max: number): number | null {
  const s = normalizePin(raw);
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
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
  // نفس حدود قاعدة البيانات (update_app_settings والقيود)
  const newMax = intIn(v.new_account_max_active_orders, 1, 1000);
  if (newMax === null) errors.new_account_max_active_orders = 'عدد من 1 إلى 1000';
  const lineQty = intIn(v.max_line_qty, 1, 99);
  if (lineQty === null) errors.max_line_qty = 'عدد من 1 إلى 99';
  const lines = intIn(v.max_order_lines, 1, 50);
  if (lines === null) errors.max_order_lines = 'عدد من 1 إلى 50';
  // T23 F M3: حدا قيمة الطلب (250 .. 100,000,000، مضاعفات 250)
  const capError = (n: number | null) =>
    n === null || n < 250
      ? 'اكتب مبلغاً بالدينار (250 أو أكثر)'
      : n % 250 !== 0
        ? 'لازم يكون من مضاعفات 250'
        : null;
  const maxOrder = amount(v.max_order_iqd);
  const maxOrderError = capError(maxOrder);
  if (maxOrderError) errors.max_order_iqd = maxOrderError;
  const newMaxOrder = amount(v.new_account_max_order_iqd);
  const newMaxOrderError = capError(newMaxOrder);
  if (newMaxOrderError) errors.new_account_max_order_iqd = newMaxOrderError;
  const message = v.closed_message.trim();
  if (message.length > 200) errors.closed_message = 'الرسالة أطول من 200 حرف';
  if (Object.keys(errors).length > 0) return { payload: null, errors };
  return {
    payload: {
      delivery_fee_iqd: fee as number,
      min_order_iqd: min as number,
      max_active_orders: max as number,
      new_account_max_active_orders: newMax as number,
      max_line_qty: lineQty as number,
      max_order_lines: lines as number,
      max_order_iqd: maxOrder as number,
      new_account_max_order_iqd: newMaxOrder as number,
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

/**
 * فشل إعادة ضبط الرمز (مراجعة جلسة C، M2). الرفض قبل أي تغيير (رمز غير مقبول، حد المعدل، صلاحية...) يبقي الرمز
 * بالحقل ليُصحَّح. أي فشل آخر (RESET_INCOMPLETE، خطأ داخلي، انقطاع لا نعرف نتيجته) قد يكون الرمز تغيّر فعلاً بلا
 * علامة أو تدقيق، فيُمسح الحقل وتُعرض رسالة "لم تكتمل" كي لا يُرسل الرمز لصاحبه.
 */
const RESET_REJECTED_BEFORE_CHANGE = new Set([
  'PIN_INVALID',
  'MFA_REQUIRED',
  'TOO_MANY_RESETS',
  'NOT_ALLOWED',
  'NOT_AUTHENTICATED',
  'PIN_CHANGE_REQUIRED',
  'ADMIN_ACCOUNT',
  'USER_NOT_FOUND',
  'INVALID_REQUEST',
]);

export function resetPinFailure(error: unknown): { message: string; clearPin: boolean } {
  // invoke() يرمي Error فيه code المقروء من جسم الرد؛ وإلا نحلّل الخطأ كما هو
  const attached = (error as { code?: unknown } | null)?.code;
  const code = isErrorCode(attached) ? attached : parseBackendError(error).code;
  if (code && RESET_REJECTED_BEFORE_CHANGE.has(code)) {
    return { message: ERROR_MESSAGES[code], clearPin: false };
  }
  return { message: ERROR_MESSAGES.RESET_INCOMPLETE, clearPin: true };
}
