// تحويل أخطاء تسليم الكاش لسلوك النافذة (SPEC-cash §4 "الأخطاء"). لا يظهر نص خام أبداً.
import { errorMessage, formatIQD, parseBackendError, type ErrorCode } from '@mukhdar/shared';

export interface CurrentBalance {
  expected_iqd: number;
  order_count: number;
}

export interface HandoverFailure {
  code: ErrorCode | null;
  message: string;
  /** المطلوب والعدد الحاليان (CASH_BALANCE_CHANGED فقط، وإن تعذّرت قراءة detail ← null) */
  balance: CurrentBalance | null;
  /** أعد جلب الأرصدة والقائمة */
  refresh: boolean;
  /** امسح المبلغ المكتوب (لا نقص وهمي) */
  clearAmount: boolean;
  /** أغلق النافذة */
  close: boolean;
  /**
   * R4 M2: الاستلام انسجل قبل (ربما بمحاولة سابقة ضاع ردّها): اجلب آخر تسليم للسائق واعرض مبلغه وملاحظته،
   * ونبّه إن اختلفا عمّا كُتب الآن. النافذة لا تُغلق تلقائياً.
   */
  lookup: boolean;
  /** مفتاح منع تكرار جديد (الحالة انحسمت). false = النتيجة مجهولة أو الرفض قبل الكتابة، أعد بنفس المفتاح */
  rotateKey: boolean;
}

/** detail من الدالة: {"expected_iqd": N, "order_count": M} نصاً. أي شكل آخر ← null. */
export function parseBalanceDetail(detail: string | null): CurrentBalance | null {
  if (!detail) return null;
  try {
    const v = JSON.parse(detail) as Record<string, unknown>;
    if (Number.isSafeInteger(v.expected_iqd) && Number.isSafeInteger(v.order_count)) {
      return { expected_iqd: v.expected_iqd as number, order_count: v.order_count as number };
    }
  } catch {
    // detail ليس JSON: نتجاهله
  }
  return null;
}

/**
 * نص تغيّر المطلوب. R4 L8: العدد نفسه والمبلغ تغيّر = تغيّر إعداد أجرة التوصيل، لا توصيل جديد.
 * shownCount غير معروف ← النص العام.
 */
export function balanceChangedMessage(balance: CurrentBalance | null, shownCount?: number): string {
  const now = balance ? ` المطلوب الآن ${formatIQD(balance.expected_iqd)}.` : '';
  const reason =
    balance && shownCount !== undefined && balance.order_count === shownCount
      ? 'تغيّر إعداد أجرة التوصيل'
      : balance && shownCount !== undefined
        ? 'تغيّر المبلغ (وصل توصيل جديد)'
        : 'تغيّر المبلغ (وصل توصيل جديد أو تغيّر إعداد الأجرة)';
  return `${reason}.${now} عدّ من جديد`;
}

export const ALREADY_RECORDED = 'انسجل الاستلام قبل شوية';

const KEEP: Omit<HandoverFailure, 'code' | 'message'> = {
  balance: null,
  refresh: false,
  clearAmount: false,
  close: false,
  lookup: false,
  rotateKey: false,
};

/** shownCount = عدد الطلبات المعروض لحظة الإرسال (لتمييز سبب CASH_BALANCE_CHANGED). */
export function handoverFailure(error: unknown, shownCount?: number): HandoverFailure {
  const parsed = parseBackendError(error);
  switch (parsed.code) {
    case 'CASH_BALANCE_CHANGED': {
      const balance = parseBalanceDetail(parsed.detail);
      return {
        ...KEEP,
        code: parsed.code,
        message: balanceChangedMessage(balance, shownCount),
        balance,
        refresh: true,
        clearAmount: true,
        rotateKey: true,
      };
    }
    case 'NO_CASH_OUTSTANDING':
      return {
        ...KEEP,
        code: parsed.code,
        message: ALREADY_RECORDED,
        refresh: true,
        lookup: true,
        rotateKey: true,
      };
    case 'INVALID_REQUEST':
      // R4 L2: نفس المفتاح بطلب مختلف (لا يحصل من هذه النافذة، المفتاح يتبدّل مع المبلغ والملاحظة): التسليم
      // بهذا المفتاح انسجل فعلاً، فيُعرض ما انسجل كما بـ NO_CASH_OUTSTANDING
      if (parsed.detail === 'idempotency_key') {
        return {
          ...KEEP,
          code: parsed.code,
          message: ALREADY_RECORDED,
          refresh: true,
          lookup: true,
          rotateKey: true,
        };
      }
      return { ...KEEP, code: parsed.code, message: parsed.message };
    case null:
      // انقطاع أو خطأ داخلي (مثل deadlock نادر): النتيجة مجهولة، أعد بنفس المفتاح
      return { ...KEEP, code: null, message: `${parsed.message}، حاول مرة ثانية` };
    default:
      return { ...KEEP, code: parsed.code, message: parsed.message };
  }
}

/** ما انسجل فعلاً (آخر تسليم للسائق) مقابل ما كُتب بالنافذة (R4 M2). */
export interface RecordedCheck {
  amountDiffers: boolean;
  noteDiffers: boolean;
}

export function compareRecorded(
  recorded: { received_iqd: number; note: string | null },
  typed: { amount: number; note: string | null },
): RecordedCheck {
  const norm = (n: string | null) => {
    const t = n?.trim() ?? '';
    return t === '' ? null : t;
  };
  return {
    amountDiffers: recorded.received_iqd !== typed.amount,
    noteDiffers: norm(recorded.note) !== norm(typed.note),
  };
}

/** تنبيه الاختلاف، أو null إن طابق ما انسجل ما كُتب. */
export function recordedMismatchWarning(
  recorded: { received_iqd: number; note: string | null },
  typed: { amount: number; note: string | null },
): string | null {
  const c = compareRecorded(recorded, typed);
  if (!c.amountDiffers && !c.noteDiffers) return null;
  const what = c.amountDiffers
    ? `المبلغ المسجّل ${formatIQD(recorded.received_iqd)} يختلف عن اللي كتبته هسه (${formatIQD(typed.amount)})`
    : 'الملاحظة المسجّلة تختلف عن اللي كتبتها هسه';
  return `${what}. إذا المسجّل غلط، خلّي المدير يصحّحه من تبويب السجل.`;
}

/** خطأ التصحيح (K12). R4 L6: HANDOVER_CHANGED يحمل المبلغ المسجّل الآن. */
export function correctionFailureMessage(error: unknown): string {
  const parsed = parseBackendError(error);
  if (parsed.code === 'HANDOVER_CHANGED') {
    const now =
      parsed.detail !== null && /^\d+$/.test(parsed.detail) ? Number(parsed.detail) : null;
    return now === null
      ? `${parsed.message}.`
      : `أدمن ثاني صحّح هذا التسليم قبلك، والمبلغ المسجّل الآن ${formatIQD(now)}. سكّر النافذة وافتحها من جديد قبل أي تصحيح.`;
  }
  return errorMessage(error);
}
