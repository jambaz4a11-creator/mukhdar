// Next 16: proxy.ts (كان middleware.ts). حماية كل المسارات عدا /login والصفحات العامة (SPEC-admin §1، T16).
// لا جلسة ← /login؛ دور غير admin/staff ← "غير مصرح"؛ موظف على صفحة أدمن ← "غير مصرح" (حتى بالرابط المباشر).
// T23: CSP بـ nonce لكل طلب (M3)، وتسجيل نشاط الجلسة وإخراج الخاملة > 12 ساعة (M7، يفرضه الخادم بقاعدة البيانات).
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@mukhdar/shared';
import { NextResponse, type NextRequest } from 'next/server';
import {
  CHANGE_PIN_PATH,
  LOGIN_PATH,
  MFA_PATH,
  NOT_AUTHORIZED_PATH,
  UNAVAILABLE_PATH,
  canAccess,
  isKnownPanelPath,
  isPublicPath,
  safeNext,
} from './lib/access';
import { readPublicEnv } from './lib/env';
import { getPanelUser, pinBeforeMfa } from './lib/panelUser';
import {
  STATIC_SECURITY_HEADERS,
  TOUCH_COOKIE,
  TOUCH_THROTTLE_S,
  buildCsp,
  newNonce,
  sessionCookieOptions,
} from './lib/security';

export async function proxy(request: NextRequest) {
  // CSP بـ nonce جديد لكل طلب: Next يقرؤه من ترويسة الطلب ويضعه على سكربتاته
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    dev: process.env.NODE_ENV === 'development',
  });
  request.headers.set('x-nonce', nonce);
  request.headers.set('content-security-policy', csp);

  const response = await handle(request);
  response.headers.set('Content-Security-Policy', csp);
  // على Cloudflare (OpenNext) لا تُطبَّق headers() من next.config على ردود الـ proxy (إعادة التوجيه)،
  // فنضع الترويسات الثابتة هنا أيضاً؛ على Node تتطابق القيم فلا فرق.
  for (const { key, value } of STATIC_SECURITY_HEADERS) response.headers.set(key, value);
  return response;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const { url, key } = readPublicEnv();
  const supabase = createServerClient<Database>(url, key, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const user = await getPanelUser(supabase);

  // تحويل/إعادة كتابة مع نقل cookies الجلسة المجددة
  const withCookies = (res: NextResponse) => {
    for (const c of response.cookies.getAll()) res.cookies.set(c);
    return res;
  };

  if (pathname === LOGIN_PATH) {
    if (user.state !== 'ok') return response;
    const home = !user.mfaRequired ? '/' : pinBeforeMfa(user) ? CHANGE_PIN_PATH : MFA_PATH;
    return withCookies(NextResponse.redirect(new URL(home, request.url)));
  }
  // تعذّر التحقق (خلل Supabase أو الشبكة أو حد موارد Cloudflare): ليس جلسة منتهية، فلا نحوّل لصفحة الدخول.
  // 503 برسالة وزر إعادة المحاولة؛ الوصول ممنوع بكل الأحوال. الجلسة المنتهية فعلاً تبقى تذهب للدخول.
  if (user.state === 'unavailable') {
    const res = withCookies(
      NextResponse.rewrite(new URL(UNAVAILABLE_PATH, request.url), { status: 503 }),
    );
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }
  if (user.state === 'anonymous') {
    if (pathname === NOT_AUTHORIZED_PATH) {
      return withCookies(NextResponse.redirect(new URL(LOGIN_PATH, request.url)));
    }
    const login = new URL(LOGIN_PATH, request.url);
    if (pathname !== '/') login.searchParams.set('next', pathname + search);
    return withCookies(NextResponse.redirect(login));
  }
  if (pathname === NOT_AUTHORIZED_PATH) return response;
  if (user.state === 'forbidden') {
    return withCookies(
      NextResponse.rewrite(new URL(NOT_AUTHORIZED_PATH, request.url), { status: 403 }),
    );
  }
  // خمول 12 ساعة (T23 M7): كل تنقّل بالجلسة المكتملة (aal2) يسجّل نشاطها؛ الخادم (touch_panel_session) هو
  // من يقرر، ويحذف الجلسة الخاملة فلا تُحيا أبداً. الـ cookie القصير لتخفيف النداءات فقط (حذفه لا يفيد أحداً:
  // الخادم يفرض الحد بنفسه). خطأ شبكة لحظي لا يُخرج أحداً.
  if (!user.mfaRequired) {
    const marker = `${user.id}`;
    if (request.cookies.get(TOUCH_COOKIE)?.value !== marker) {
      const { data: alive, error } = await supabase.rpc('touch_panel_session');
      if (!error && alive === false) {
        await supabase.auth.signOut({ scope: 'local' });
        const login = new URL(LOGIN_PATH, request.url);
        login.searchParams.set('reason', 'idle');
        const res = withCookies(NextResponse.redirect(login));
        res.cookies.set(TOUCH_COOKIE, '', { path: '/', maxAge: 0 });
        return res;
      }
      if (!error) {
        response.cookies.set(TOUCH_COOKIE, marker, {
          ...sessionCookieOptions(),
          httpOnly: true,
          maxAge: TOUCH_THROTTLE_S,
        });
      }
    }
  }
  // T23 F M2: رمز مؤقت بلا عامل TOTP ← تغيير الرمز أولاً (بجلسة aal1)، ثم تسجيل التطبيق. من يعرف الرمز
  // المؤقت فقط لا يسجّل تطبيقه قبل صاحب الحساب (وقاعدة البيانات تحذف أي عامل سُجّل أثناء الرمز المؤقت).
  if (user.mfaRequired && pinBeforeMfa(user)) {
    if (pathname === CHANGE_PIN_PATH) return response;
    return withCookies(NextResponse.redirect(new URL(CHANGE_PIN_PATH, request.url)));
  }
  // المصادقة الثنائية (T23 C1): بالـ PIN وحده (aal1) كل صفحة ← /mfa (الخادم يرفض دوال الدور أصلاً)
  if (user.mfaRequired) {
    if (pathname === MFA_PATH) return response;
    const mfa = new URL(MFA_PATH, request.url);
    if (pathname !== '/') mfa.searchParams.set('next', pathname + search);
    return withCookies(NextResponse.redirect(mfa));
  }
  if (pathname === MFA_PATH) {
    // اكتملت: لا داعي للصفحة
    const next = safeNext(request.nextUrl.searchParams.get('next'));
    return withCookies(NextResponse.redirect(new URL(next === MFA_PATH ? '/' : next, request.url)));
  }
  // رمز مؤقت: كل صفحة ← تغيير الرمز (الخادم يرفض دوال الدور أصلاً حتى يُغيَّر)
  if (user.mustChangePin && pathname !== CHANGE_PIN_PATH) {
    return withCookies(NextResponse.redirect(new URL(CHANGE_PIN_PATH, request.url)));
  }
  if (isKnownPanelPath(pathname) && !canAccess(user.role, pathname)) {
    return withCookies(
      NextResponse.rewrite(new URL(NOT_AUTHORIZED_PATH, request.url), { status: 403 }),
    );
  }
  return response;
}

export const config = {
  // كل شيء عدا ملفات Next الثابتة والصور والخطوط
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$).*)',
  ],
};
