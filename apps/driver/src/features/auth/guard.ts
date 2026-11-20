// حارس الحالة (SPEC-driver §2.1) كدالة صرفة: الحالة + المسار الحالي ← وجهة، أو null (ابقَ).
// قاعدة البيانات هي الحَكَم (دوال السائق ترفض غير السائق الفعّال)؛ هذا لتوجيه الشاشات فقط.

export const ROUTES = {
  login: '/auth/login',
  register: '/auth/register',
  pending: '/auth/pending',
  setPin: '/auth/set-pin',
  changePin: '/auth/change-pin',
  notDriver: '/auth/not-driver',
  offline: '/auth/offline',
  home: '/',
} as const;

export interface DriverProfile {
  role: string | null;
  is_active: boolean;
  must_change_pin: boolean;
  full_name: string | null;
  phone: string | null;
}

export interface GuardState {
  /** الجلسة المحفوظة والطلب المحفوظ قُرئا */
  ready: boolean;
  session: { user: { id: string } } | null;
  /** null = لم يُقرأ بعد (أو تعذّرت القراءة) */
  profile: DriverProfile | null;
  /** آخر قراءة للملف الشخصي فشلت (شبكة) */
  profileError: boolean;
  /** request_id + سر الجهاز محفوظان */
  hasRegistration: boolean;
  /**
   * تعذّر تجديد الجلسة المحفوظة بسبب الشبكة (لا رفض من الخادم): الجلسة باقية بالجهاز، فلا نرمي السائق لشاشة
   * الدخول ولا نمسحها. تظهر "ماكو اتصال" مع إعادة المحاولة (R1 M2).
   */
  sessionOffline?: boolean;
}

const isAuthPath = (p: string) => p === '/auth' || p.startsWith('/auth/');

/** شاشة انتظار فوق التنقل: قبل أن نعرف أين نذهب. */
export function isGuardBlocking(s: GuardState): boolean {
  return !s.ready || (s.session !== null && s.profile === null && !s.profileError);
}

export function guardRedirect(s: GuardState, pathname: string): string | null {
  if (isGuardBlocking(s)) return null;
  const only = (target: string, allowed: readonly string[] = [target]) =>
    allowed.includes(pathname) ? null : target;

  if (s.session) {
    const p = s.profile;
    // تعذّرت القراءة بلا ملف معروف: لا نحبسه بشاشة الدخول؛ دوال السائق ترفض إن لم يكن سائقاً
    if (!p) return isAuthPath(pathname) ? ROUTES.home : null;
    if (p.must_change_pin) return only(ROUTES.changePin);
    if (p.role !== 'driver' || !p.is_active) return only(ROUTES.notDriver);
    return isAuthPath(pathname) ? ROUTES.home : null;
  }
  if (s.sessionOffline) return only(ROUTES.offline);
  if (s.hasRegistration) return only(ROUTES.pending, [ROUTES.pending, ROUTES.setPin]);
  return only(ROUTES.login, [ROUTES.login, ROUTES.register]);
}
