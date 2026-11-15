// Next 16: proxy.ts (كان middleware.ts). حماية كل المسارات عدا /login والصفحات العامة (SPEC-admin §1، T16).
// لا جلسة ← /login؛ دور غير admin/staff ← "غير مصرح"؛ موظف على صفحة أدمن ← "غير مصرح" (حتى بالرابط المباشر).
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@mukhdar/shared';
import { NextResponse, type NextRequest } from 'next/server';
import {
  LOGIN_PATH,
  NOT_AUTHORIZED_PATH,
  canAccess,
  isKnownPanelPath,
  isPublicPath,
} from './lib/access';
import { readPublicEnv } from './lib/env';
import { getPanelUser } from './lib/panelUser';

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  let response = NextResponse.next({ request });
  const { url, key } = readPublicEnv();
  const supabase = createServerClient<Database>(url, key, {
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
    return user.state === 'ok'
      ? withCookies(NextResponse.redirect(new URL('/', request.url)))
      : response;
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
