// حالة الجلسة للتطبيق كله (T10): تُقرأ من Supabase عند التشغيل وتتبع onAuthStateChange.
// التجديد التلقائي للتوكن يعمل فقط والتطبيق بالواجهة (توصية Supabase لـ React Native).
import type { MukhdarClient, Session } from '@mukhdar/shared';
import { AppState } from 'react-native';
import { fetchMustChangePin } from './forcedPin';
import { create } from 'zustand';

export interface AuthState {
  session: Session | null;
  /** false حتى تُقرأ الجلسة المحفوظة (الحارس لا يحوّل قبلها). */
  ready: boolean;
  /** رمز مؤقت من المتجر لم يُغيَّر (profiles.must_change_pin): الحارس يفرض شاشة التغيير (M3). */
  mustChangePin: boolean;
}

export const useAuth = create<AuthState>(() => ({
  session: null,
  ready: false,
  mustChangePin: false,
}));

/** يحدّث mustChangePin من الجلسة الحالية (عند الاستعادة والدخول والعودة للتطبيق). */
export async function refreshMustChangePin(client: MukhdarClient): Promise<void> {
  const session = useAuth.getState().session;
  if (!session) return;
  const flag = await fetchMustChangePin(client, session.user.id);
  // الجلسة قد تغيّرت أثناء القراءة (خروج/دخول آخر): لا نكتب نتيجة قديمة
  if (flag !== null && useAuth.getState().session?.user.id === session.user.id) {
    useAuth.setState({ mustChangePin: flag });
  }
}

/** يربط الحالة بالـ client، ويرجع دالة الإلغاء. client = null (بلا .env): لا جلسة. */
export function initAuth(client: MukhdarClient | null): () => void {
  if (!client) {
    useAuth.setState({ session: null, ready: true, mustChangePin: false });
    return () => undefined;
  }
  client.auth
    .getSession()
    .then(({ data }) => {
      useAuth.setState({ session: data.session, ready: true });
      // جلسة محفوظة (إعادة تشغيل): تُقرأ العلامة ليُفرض تغيير الرمز المؤقت
      void refreshMustChangePin(client);
    })
    .catch(() => useAuth.setState({ session: null, ready: true, mustChangePin: false }));
  const { data } = client.auth.onAuthStateChange((event, session) => {
    // بلا خروج: العلامة تبقى حتى تُقرأ من جديد (مستخدم آخر لا يرثها)
    useAuth.setState(
      session ? { session, ready: true } : { session, ready: true, mustChangePin: false },
    );
    // لا استدعاء Supabase داخل هذه الدالة مباشرة (توصية supabase-js): نؤجله
    if (session && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
      setTimeout(() => void refreshMustChangePin(client), 0);
    }
  });

  const syncRefresh = (state: string) => {
    if (state === 'active') {
      void client.auth.startAutoRefresh();
      // العودة للتطبيق: الأدمن قد يكون أعاد ضبط الرمز أثناء غيابه
      void refreshMustChangePin(client);
    } else void client.auth.stopAutoRefresh();
  };
  syncRefresh(AppState.currentState ?? 'active');
  const sub = AppState.addEventListener('change', syncRefresh);

  return () => {
    data.subscription.unsubscribe();
    sub.remove();
  };
}
