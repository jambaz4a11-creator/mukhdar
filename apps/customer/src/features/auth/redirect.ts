// الرجوع بعد الدخول لنفس المكان (T10): الشاشة المحمية تمرر مسارها كـ redirect.
// يُقبل مسار داخلي فقط ("/orders"، "/product/12")، لا رابط خارجي ولا شاشات الدخول نفسها.

export const SIGN_IN = '/auth/sign-in';
export const SIGN_UP = '/auth/sign-up';
export const NAME = '/auth/name';

export function safeRedirect(raw: unknown): string {
  const value = Array.isArray(raw) ? (raw[0] as unknown) : raw;
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /^\/auth(\/|$)/.test(value)
  ) {
    return '/';
  }
  return value;
}

/** رابط شاشة الدخول من شاشة محمية. */
export function signInHref(from: string) {
  return { pathname: SIGN_IN, params: { redirect: safeRedirect(from) } } as const;
}
