// حارس الشاشات المحمية (طلباتي، حسابي، لاحقاً تأكيد الطلب): بلا جلسة ← الدخول، ثم الرجوع لنفس المسار.
// التصفح والسلة لا يستخدمانه (بدون دخول).
import type { Session } from '@mukhdar/shared';
import { router, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { signInHref } from './redirect';
import { useAuth } from './store';

export function useRequireAuth(): Session | null {
  const session = useAuth((s) => s.session);
  const ready = useAuth((s) => s.ready);
  const pathname = usePathname();
  useEffect(() => {
    if (ready && !session) router.replace(signInHref(pathname));
  }, [ready, session, pathname]);
  return session;
}
