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
  // T23 H2: الحدان من app_settings، والتفصيل (detail) = الحد؛ التطبيق يضيفه للرسالة
  TOO_MANY_ITEMS: 'السلة فيها منتجات كثيرة بالطلب الواحد، احذف بعضها ثم أرسل الطلب',
  QTY_LIMIT: 'كمية أحد المنتجات أكثر من المسموح بالطلب الواحد، قلّلها ثم أرسل الطلب',
  INVALID_QTY: 'الكمية غير صحيحة (من 1 إلى 99)',
  PRODUCT_UNAVAILABLE: 'أحد المنتجات لم يعد متوفراً',
  INSUFFICIENT_STOCK: 'الكمية المطلوبة من أحد المنتجات غير متوفرة',
  BELOW_MIN_ORDER: 'المجموع أقل من الحد الأدنى للطلب',
  // T23 F M3: حد قيمة الطلب (مع التوصيل)؛ التفصيل (detail) = الحد بالدينار، التطبيق يضيفه للرسالة
  ORDER_TOO_LARGE: 'مجموع الطلب أكبر من الحد المسموح للطلب الواحد، قلّل الكميات أو قسّمه على طلبين',
  NEW_ACCOUNT_ORDER_LIMIT:
    'أول طلب لحساب جديد له حد أقصى للمجموع، قلّل الكميات حتى يُسلَّم أول طلب لك',

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
  COMMENT_TOO_LONG: 'التعليق أطول من 500 حرف',
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
  INVALID_CATEGORY: 'بيانات القسم غير صحيحة (الاسم من 1 إلى 40 حرف)',
  CATEGORY_NOT_FOUND: 'القسم غير موجود',
  CATEGORY_NAME_TAKEN: 'يوجد قسم بنفس الاسم',
  CATEGORY_HAS_PRODUCTS: 'القسم فيه منتجات: لا يُحذف، أخفِه بدل الحذف',
  INVALID_DATE_RANGE: 'مدى التاريخ غير صحيح (حتى سنة واحدة)',
  CANNOT_DEMOTE_SELF: 'لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك',
  USER_NOT_FOUND: 'المستخدم غير موجود',
  INVALID_SETTINGS: 'قيمة غير صحيحة بالإعدادات (المبالغ من مضاعفات 250)',
  INVALID_BUILDINGS: 'أرقام العمارات غير صحيحة (من 1 إلى 9999، حتى 500 بالمرة)',
  INVALID_ROLE: 'الدور غير مسموح (موظف أو سائق فقط)',
  INVALID_REQUEST: 'بيانات الطلب غير صحيحة',
  // مراجعة T16-T19 (جلسة A)
  DRIVER_HAS_ORDERS: 'السائق عنده طلبات لم تنتهِ: انقلها لسائق آخر أو أكملها أولاً',
  LAST_ADMIN: 'لازم يبقى أدمن واحد نشط على الأقل',
  PIN_CHANGE_REQUIRED: 'رمزك مؤقت: غيّره أولاً من "تغيير الرمز"',
  // مراجعة جلسة C
  DRIVER_PIN_PENDING: 'السائق لم يغيّر رمزه المؤقت بعد، لا يمكن تعيين طلب له',
  RESET_INCOMPLETE: 'لم تكتمل إعادة الضبط: أعد المحاولة ولا ترسل الرمز',
  // Edge Functions admin-reset-pin وadmin-create-user (T19)
  TOO_MANY_RESETS: 'وصلت حد إعادة الضبط (20 بالساعة)، انتظر قليلاً',
  // T23 C1: الأدمن والموظف يحتاجان جلسة aal2 (رمز تطبيق المصادقة بعد الـ PIN)
  MFA_REQUIRED: 'أكمل الدخول برمز تطبيق المصادقة أولاً',
  // T23 جلسة E2: خمول اللوحة 12 ساعة (M7)، إلغاء كل طلبات الزبون (H2)، حد العناوين (L3)
  SESSION_EXPIRED: 'انتهت جلستك بعد 12 ساعة بلا نشاط، سجّل الدخول من جديد',
  NOT_A_CUSTOMER: 'هذا الإجراء للزبائن فقط',
  ADDRESS_LIMIT: 'وصلت الحد الأقصى من العناوين (20)، احذف عنواناً قديماً أولاً',
  // 2026-11-18: الطابق إلزامي للعنوان الجديد
  FLOOR_REQUIRED: 'اختر الطابق',
  // 2026-11-19: نطاقات بسماية (الطابق G..9، الشقة 1..12، بلوك وبناية فعّالان)
  FLOOR_INVALID: 'الطابق من G إلى 9',
  APARTMENT_INVALID: 'رقم الشقة من 1 إلى 12',
  BUILDING_INACTIVE: 'هذي البناية أو البلوك ما عاد متاح، اختر من القائمة',
  // T27: تسجيل السائق الذاتي (SPEC-driver §2.3–§2.5، §4.5) وقرار الأدمن (§5)
  NAME_INVALID: 'اكتب اسمك الكامل (من 2 إلى 80 حرف)',
  REQUEST_EXISTS: 'أكو طلب لهذا الرقم بانتظار الموافقة',
  TOO_MANY_PENDING: 'طلبات التسجيل كثيرة هسه، حاول بعد شوية أو اتصل بالمحل',
  REGISTER_FAILED: 'تعذّر إرسال الطلب، حاول مرة ثانية',
  REQUEST_NOT_FOUND: 'طلب التسجيل غير موجود، سجّل من جديد',
  REQUEST_NOT_APPROVED: 'طلبك بعده ما انقبل، انتظر موافقة المحل',
  REQUEST_EXPIRED: 'انتهت مدة الموافقة، سجّل من جديد',
  REQUEST_ALREADY_DECIDED: 'هذا الطلب انحسم قبل، حدّث الصفحة',
  // T23 F M2: ترقية زبون/سائق للوحة تتطلب رمزاً مؤقتاً أولاً
  PIN_RESET_REQUIRED:
    'لترقية هذا الحساب لموظف أو أدمن: أعد ضبط رمزه أولاً (رمز مؤقت)، ثم غيّر الدور. يغيّر صاحبه الرمز ثم يسجّل تطبيق المصادقة',
} as const satisfies Record<string, string>;

export type ErrorCode = keyof typeof ERROR_MESSAGES;
export const ERROR_CODES = Object.keys(ERROR_MESSAGES) as ErrorCode[];

export const DEFAULT_ERROR_MESSAGE = 'حدث خطأ غير متوقع، حاول مرة ثانية';
export const NETWORK_ERROR_MESSAGE = 'تعذّر الاتصال، تحقق من الإنترنت وحاول مرة ثانية';
/**
 * Postgres 42501 بلا رمز معروف (صلاحية ناقصة أو سياسة RLS رفضت الصف): خطأ من جهتنا لا من المستخدم
 * (بلاغ iOS Safari 2026-11-18). رسالة محددة بدل العامة حتى يعرف أنه ليس انقطاعاً وأن يتواصل مع المتجر.
 */
export const PERMISSION_ERROR_MESSAGE =
  'ما قدرنا نحفظ هذا التغيير لأن حسابك ما عنده صلاحية له. سجّل الخروج وادخل من جديد، وإذا تكرر تواصل مع المتجر على واتساب';

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
const PERMISSION_PATTERN = /permission denied|violates row-level security/i;

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
  // PostgREST: details؛ جسم Edge Function: detail (مثل PIN_INVALID من driver-complete-registration)
  const detailValue =
    typeof error === 'object' && error !== null
      ? ((error as { details?: unknown }).details ?? (error as { detail?: unknown }).detail ?? null)
      : null;
  const detail = typeof detailValue === 'string' && detailValue !== '' ? detailValue : null;
  const code = raw.trim();

  if (isErrorCode(code)) return { code, message: ERROR_MESSAGES[code], detail };
  const sqlState =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : null;
  if (sqlState === '42501' || PERMISSION_PATTERN.test(raw))
    return { code: null, message: PERMISSION_ERROR_MESSAGE, detail: null };
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
