// رموز أخطاء الخلفية ← رسائل عربية. الخلفية ترجع الرمز بـ error.message (SPEC-backend §5)،
// و error.details يحمل معلومة إضافية (مثل product_id). Edge Functions ترجع {"error": CODE}
// (SPEC-backend §8). أي رمز جديد بقاعدة البيانات أو بدالة يُضاف هنا وبـ SPEC-backend، واختبار
// errors.test.ts يفشل إن نقص أحدهما.

export const ERROR_MESSAGES = {
  // عامة
  NOT_AUTHENTICATED: 'انتهت الجلسة، سجّل الدخول من جديد',
  NOT_ALLOWED: 'ليست لديك صلاحية لهذا الإجراء',
  // الحسابات (trigger على auth.users، ADR 0001): كل حساب برقم موبايل عراقي
  PHONE_INVALID: 'رقم الهاتف غير صحيح، اكتب رقم موبايل عراقي يبدأ بـ 07',

  // place_order
  NOT_CUSTOMER: 'هذا الحساب لا يستطيع إرسال طلبات',
  PHONE_REQUIRED: 'أضف رقم هاتفك إلى حسابك قبل الطلب',
  IDEMPOTENCY_KEY_REQUIRED: 'تعذّر إرسال الطلب، حاول مرة ثانية',
  TOO_MANY_ACTIVE_ORDERS: 'لديك طلبات جارية كثيرة. انتظر وصول أحدها ثم اطلب من جديد',
  STORE_CLOSED: 'المتجر مغلق حالياً',
  ADDRESS_NOT_FOUND: 'العنوان غير موجود، اختر عنواناً آخر',
  ADDRESS_INACTIVE: 'لا نوصّل إلى هذا العنوان حالياً، اختر عنواناً آخر',
  EMPTY_CART: 'السلة فارغة',
  TOO_MANY_ITEMS: 'السلة فيها منتجات كثيرة (الحد 50 منتجاً)',
  INVALID_QTY: 'الكمية غير صحيحة (من 1 إلى 99)',
  PRODUCT_UNAVAILABLE: 'أحد المنتجات لم يعد متوفراً',
  INSUFFICIENT_STOCK: 'الكمية المطلوبة من أحد المنتجات غير متوفرة',
  BELOW_MIN_ORDER: 'المجموع أقل من الحد الأدنى للطلب',

  // حالة الطلب والسائق
  ORDER_NOT_FOUND: 'الطلب غير موجود',
  INVALID_TRANSITION: 'تغيّرت حالة الطلب، حدّث الصفحة وحاول مرة ثانية',
  NO_DRIVER_ASSIGNED: 'عيّن سائقاً للطلب أولاً',
  ORDER_NOT_AVAILABLE: 'أخذه سائق آخر أو لم يعد متاحاً',
  DRIVER_NOT_FOUND: 'السائق غير موجود أو غير مفعّل',

  // التقييم والإشعارات
  INVALID_STARS: 'اختر تقييماً من 1 إلى 5 نجوم',
  ORDER_NOT_RATEABLE: 'لا يمكن تقييم هذا الطلب',
  ALREADY_RATED: 'قيّمت هذا الطلب مسبقاً',
  INVALID_TOKEN: 'تعذّر تفعيل الإشعارات على هذا الجهاز',

  // حذف الحساب (Edge Function delete-account)
  ACTIVE_ORDER: 'لا يمكن حذف الحساب أثناء وجود طلب جارٍ',
  ADMIN_ACCOUNT: 'حساب المدير لا يُحذف من التطبيق، تواصل مع الإدارة',

  // التسجيل (Edge Function signup، ADR 0001): رموز عامة فقط
  PIN_INVALID: 'الرمز غير مقبول: 6 أرقام بلا تكرار أو تسلسل، وليس من رقم هاتفك',
  PHONE_TAKEN: 'هذا الرقم مسجّل، سجّل الدخول',
  RATE_LIMITED: 'محاولات كثيرة، انتظر قليلاً وحاول مرة ثانية',
  SIGNUP_FAILED: 'تعذّر إنشاء الحساب، حاول مرة ثانية',

  // الأدمن
  INVALID_MOVEMENT: 'حركة المخزون غير صحيحة',
  PRODUCT_NOT_FOUND: 'المنتج غير موجود',
  INVALID_PRODUCT: 'بيانات المنتج غير صحيحة',
  INVALID_DATE_RANGE: 'مدى التاريخ غير صحيح (حتى سنة واحدة)',
  CANNOT_DEMOTE_SELF: 'لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك',
  USER_NOT_FOUND: 'المستخدم غير موجود',
} as const satisfies Record<string, string>;

export type ErrorCode = keyof typeof ERROR_MESSAGES;
export const ERROR_CODES = Object.keys(ERROR_MESSAGES) as ErrorCode[];

export const DEFAULT_ERROR_MESSAGE = 'حدث خطأ غير متوقع، حاول مرة ثانية';
export const NETWORK_ERROR_MESSAGE = 'تعذّر الاتصال، تحقق من الإنترنت وحاول مرة ثانية';

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);
}

export interface BackendError {
  /** رمز معروف، أو null لخطأ غير معروف (شبكة، خطأ داخلي...). */
  code: ErrorCode | null;
  /** رسالة عربية جاهزة للعرض. */
  message: string;
  /** error.details من الخلفية (مثلاً product_id لـ INSUFFICIENT_STOCK)، إن وُجد. */
  detail: string | null;
}

const NETWORK_PATTERN =
  /failed to fetch|network request failed|networkerror|load failed|fetch failed/i;

/**
 * يحوّل أي خطأ (رمز نصي، خطأ PostgREST {message, details}، جسم رد Edge Function {error}، أو Error)
 * إلى رسالة عربية.
 * لا يعرض للمستخدم نص الخطأ الخام أبداً.
 */
export function parseBackendError(error: unknown): BackendError {
  // جسم رد Edge Function: {"error": "ACTIVE_ORDER"}
  const bodyCode =
    typeof error === 'object' && error !== null && 'error' in error
      ? (error as { error: unknown }).error
      : null;
  const raw =
    typeof error === 'string'
      ? error
      : isErrorCode(typeof bodyCode === 'string' ? bodyCode.trim() : bodyCode)
        ? String(bodyCode)
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';
  const detailValue =
    typeof error === 'object' && error !== null && 'details' in error
      ? (error as { details: unknown }).details
      : null;
  const detail = typeof detailValue === 'string' && detailValue !== '' ? detailValue : null;
  const code = raw.trim();

  if (isErrorCode(code)) return { code, message: ERROR_MESSAGES[code], detail };
  if (NETWORK_PATTERN.test(raw))
    return { code: null, message: NETWORK_ERROR_MESSAGE, detail: null };
  return { code: null, message: DEFAULT_ERROR_MESSAGE, detail: null };
}

/**
 * خطأ من supabase.functions.invoke (مثل delete-account). FunctionsHttpError يحمل الرد بـ
 * error.context (Response) وجسمه {"error": "CODE"} يحتاج قراءة غير متزامنة؛ تمريره مباشرة
 * لـ parseBackendError يعطي الرسالة العامة. FunctionsFetchError = فشل الاتصال.
 */
export async function parseFunctionError(error: unknown): Promise<BackendError> {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (name === 'FunctionsFetchError') {
      return { code: null, message: NETWORK_ERROR_MESSAGE, detail: null };
    }
    const context = (error as { context?: unknown }).context;
    if (
      typeof context === 'object' &&
      context !== null &&
      typeof (context as { json?: unknown }).json === 'function'
    ) {
      try {
        const res = context as Response;
        const body: unknown = await (typeof res.clone === 'function' ? res.clone() : res).json();
        const parsed = parseBackendError(body);
        if (parsed.code) return parsed;
      } catch {
        // جسم غير JSON أو مقروء مسبقاً: نكمل بالخطأ نفسه
      }
    }
  }
  return parseBackendError(error);
}

/** اختصار: الرسالة العربية فقط. */
export function errorMessage(error: unknown): string {
  return parseBackendError(error).message;
}
