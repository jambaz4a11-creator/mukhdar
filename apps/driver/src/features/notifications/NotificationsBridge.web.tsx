// الويب (T38، SPEC-webpush §5.2/§5.6): يعيد تسجيل اشتراك Web Push بصمت عند كل تشغيل/رجوع للتبويب بجلسة سائق فعّالة (بلا
// أي طلب إذن: الإذن من لمسة بطاقة التمهيد فقط)، ويستقبل رسائل sw.js: "وصل إشعار" ← تحديث الشاشات، و"نُقر إشعار" ←
// routeForNotification نفسها (UUID + أنواع معروفة) بعد أن يعرف الحارس الوجهة. نفس أسماء التصدير للنسخة الأصلية.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { canUseRemotePush } from '../../lib/push';
import { getSupabase } from '../../lib/supabase';
import { getWebPush } from '../../lib/webPushController';
import { isGuardBlocking } from '../auth/guard';
import { useAuth } from '../auth/store';
import { emitNotification } from './events';
import { routeForNotification } from './routing';

export const PUSH_ASKED_KEY = 'mukhdar.driver.pushAsked';

const CLICK = 'mukhdar:notification-click';
const RECEIVED = 'mukhdar:notification-received';
const CHANGED = 'mukhdar:subscription-change';

interface SwContainer {
  addEventListener(type: 'message', fn: (e: { data?: unknown }) => void): void;
  removeEventListener(type: 'message', fn: (e: { data?: unknown }) => void): void;
}

export function NotificationsBridge() {
  const userId = useAuth((s) => s.session?.user.id);
  const isActiveDriver = useAuth(
    (s) => s.profile?.role === 'driver' && s.profile.is_active && !s.profile.must_change_pin,
  );
  const state = useAuth();
  const guardReady = !isGuardBlocking(state);
  const [click, setClick] = useState<unknown>(null);
  const clickRef = useRef<unknown>(null);

  // تسجيل صامت: كل تشغيل/دخول/رجوع للتبويب، وعند تغيّر الاشتراك من النظام
  useEffect(() => {
    const client = getSupabase();
    if (!userId || !isActiveDriver || !client || !canUseRemotePush()) return undefined;
    // userId: نفس الحساب ونفس الـ endpoint خلال ساعة ← بلا RPC (R3 L4)
    const silent = () => void getWebPush().register(client, { ask: false, userId });
    silent();
    const onVisible = () => {
      if (document.visibilityState === 'visible') silent();
    };
    document.addEventListener('visibilitychange', onVisible);
    const sw = navigator.serviceWorker as unknown as SwContainer;
    const onChanged = (e: { data?: unknown }) => {
      if ((e.data as { type?: string } | undefined)?.type === CHANGED) silent();
    };
    sw.addEventListener('message', onChanged);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      sw.removeEventListener('message', onChanged);
    };
  }, [userId, isActiveDriver]);

  // R3 L1: الجلسة ضاعت بلا خروج (رمز التحديث أُبطل/انتهى): لا جلسة لحذف الصف، فنبطل الاشتراك محلياً (خدمة الدفع
  // ترجع 410 فيحذف المرسِل الصف) حتى لا يستقبل الجهاز إشعارات حساب لم يعد داخلاً. بعد signOut() لا اشتراك فلا شيء.
  useEffect(() => {
    const client = getSupabase();
    if (!client || !canUseRemotePush()) return undefined;
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setTimeout(() => void getWebPush().unsubscribeLocal(), 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // رسائل الـ SW: وصول إشعار (تحديث فوري) ونقره (توجيه)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    const sw = navigator.serviceWorker as unknown as SwContainer;
    const onMessage = (e: { data?: unknown }) => {
      const msg = e.data as { type?: string; data?: unknown } | undefined;
      if (msg?.type === RECEIVED) emitNotification(msg.data);
      else if (msg?.type === CLICK) {
        clickRef.current = msg.data;
        setClick(msg.data);
      }
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, []);

  // النقر: ننتظر الحارس حتى يعرف الوجهة (بلا جلسة يذهب للدخول)، ثم نوجّه مرة واحدة
  useEffect(() => {
    if (click === null || !guardReady) return;
    const route = routeForNotification(clickRef.current);
    clickRef.current = null;
    setClick(null);
    if (route) router.push(route as never);
  }, [click, guardReady]);

  return null;
}
