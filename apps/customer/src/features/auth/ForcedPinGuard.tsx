// حارس الجذر (مراجعة جلسة C، M3): يُركَّب مرة داخل الجذر. ما دام المستخدم برمز مؤقت يُعاد توجيهه لشاشة تغيير
// الرمز عند أي تنقل (رابط عميق، رجوع، إعادة تشغيل). لا يعرض شيئاً.
import { router, useRootNavigationState, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { forcedPinRedirect } from './forcedPin';
import { useAuth } from './store';

export function ForcedPinGuard() {
  const session = useAuth((s) => s.session);
  const ready = useAuth((s) => s.ready);
  const mustChangePin = useAuth((s) => s.mustChangePin);
  const pathname = usePathname();
  const navReady = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    if (!navReady) return;
    const href = forcedPinRedirect({ ready, session, mustChangePin, pathname });
    if (href) router.replace(href);
  }, [navReady, ready, session, mustChangePin, pathname]);

  return null;
}
