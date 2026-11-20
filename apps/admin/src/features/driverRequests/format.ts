// طلبات السواق (T29): تنسيق خالص بلا شبكة، ليُختبر بوحدة. الأرقام لاتينية بكل مكان باللوحة.
import { parseBackendError } from '@mukhdar/shared';

/** حد ملاحظة الرفض بقاعدة البيانات (decide_driver_request). */
export const NOTE_MAX = 300;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "منذ 5 دقائق" بالعربية الصحيحة للمفرد والمثنى والجمع. تاريخ غير صالح ← ''. الساعة الأسبق من الخادم ← "الآن". */
export function sinceLabel(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const ms = Math.max(0, now - t);
  if (ms < MIN) return 'الآن';
  if (ms < HOUR) {
    const n = Math.floor(ms / MIN);
    return n === 1
      ? 'منذ دقيقة'
      : n === 2
        ? 'منذ دقيقتين'
        : `منذ ${n} ${n <= 10 ? 'دقائق' : 'دقيقة'}`;
  }
  if (ms < DAY) {
    const n = Math.floor(ms / HOUR);
    return n === 1 ? 'منذ ساعة' : n === 2 ? 'منذ ساعتين' : `منذ ${n} ${n <= 10 ? 'ساعات' : 'ساعة'}`;
  }
  const n = Math.floor(ms / DAY);
  return n === 1 ? 'منذ يوم' : n === 2 ? 'منذ يومين' : `منذ ${n} ${n <= 10 ? 'أيام' : 'يوماً'}`;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'بانتظار الموافقة',
  approved: 'موافَق عليه',
  rejected: 'مرفوض',
  completed: 'اكتمل التسجيل',
  // محسوبة بقاعدة البيانات (موافقة مضى عليها 7 أيام بلا اختيار رمز)، لا تُخزَّن
  expired: 'منتهية',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** موافقة قائمة (سارية أو منتهية) يسحبها الأدمن (R1 M1)؛ المكتمل والمرفوض لا. */
export function canWithdraw(status: string): boolean {
  return status === 'approved' || status === 'expired';
}

/** الموافقة مستحيلة بلا خانة "اتصلت وتأكدت" (SPEC-driver §5). */
export function approveBlocked(confirmedCall: boolean): boolean {
  return !confirmedCall;
}

const PHONE_TAKEN_MESSAGE = 'الرقم صار له حساب. رقّيه كسائق من صفحة الموظفين (بعد إعادة ضبط رمزه)';

/** رسالة خطأ القرار، و`refresh` = أعد جلب القوائم (الطلب انحسم أو انحذف). لا يظهر نص خام أبداً. */
export function decisionErrorMessage(error: unknown): { message: string; refresh: boolean } {
  const parsed = parseBackendError(error);
  if (parsed.code === 'PHONE_TAKEN') return { message: PHONE_TAKEN_MESSAGE, refresh: false };
  const refresh = parsed.code === 'REQUEST_ALREADY_DECIDED' || parsed.code === 'REQUEST_NOT_FOUND';
  return { message: parsed.message, refresh };
}
