// تحويل أخطاء تسجيل التسليم لسلوك النافذة (SPEC-cash §4 "الأخطاء"). لا يظهر نص خام أبداً.
import { formatIQD, parseBackendError, type ErrorCode } from '@mukhdar/shared';

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

const KEEP: Omit<HandoverFailure, 'code' | 'message'> = {
  balance: null,
  refresh: false,
  clearAmount: false,
  close: false,
  rotateKey: false,
};

export function handoverFailure(error: unknown): HandoverFailure {
  const parsed = parseBackendError(error);
  switch (parsed.code) {
    case 'CASH_BALANCE_CHANGED': {
      const balance = parseBalanceDetail(parsed.detail);
      const message = balance
        ? `تغيّر المبلغ (وصل توصيل جديد). المطلوب الآن ${formatIQD(balance.expected_iqd)}. عدّ من جديد`
        : 'تغيّر المبلغ (وصل توصيل جديد). عدّ من جديد';
      return {
        ...KEEP,
        code: parsed.code,
        message,
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
        message: 'انسجل الاستلام قبل شوية',
        refresh: true,
        close: true,
        rotateKey: true,
      };
    case null:
      // انقطاع أو خطأ داخلي (مثل deadlock نادر): النتيجة مجهولة، أعد بنفس المفتاح
      return { ...KEEP, code: null, message: `${parsed.message}، حاول مرة ثانية` };
    default:
      return { ...KEEP, code: parsed.code, message: parsed.message };
  }
}
