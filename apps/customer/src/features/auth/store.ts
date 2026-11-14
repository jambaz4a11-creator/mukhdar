// حالة الجلسة للتطبيق كله (T10): تُقرأ من Supabase عند التشغيل وتتبع onAuthStateChange.
// التجديد التلقائي للتوكن يعمل فقط والتطبيق بالواجهة (توصية Supabase لـ React Native).
import type { MukhdarClient, Session } from '@mukhdar/shared';
import { AppState } from 'react-native';
import { create } from 'zustand';

export interface AuthState {
  session: Session | null;
  /** false حتى تُقرأ الجلسة المحفوظة (الحارس لا يحوّل قبلها). */
  ready: boolean;
}

export const useAuth = create<AuthState>(() => ({ session: null, ready: false }));

/** يربط الحالة بالـ client، ويرجع دالة الإلغاء. client = null (بلا .env): لا جلسة. */
export function initAuth(client: MukhdarClient | null): () => void {
  if (!client) {
    useAuth.setState({ session: null, ready: true });
    return () => undefined;
  }
  client.auth
    .getSession()
    .then(({ data }) => useAuth.setState({ session: data.session, ready: true }))
    .catch(() => useAuth.setState({ session: null, ready: true }));
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    useAuth.setState({ session, ready: true });
  });

  const syncRefresh = (state: string) => {
    if (state === 'active') void client.auth.startAutoRefresh();
    else void client.auth.stopAutoRefresh();
  };
  syncRefresh(AppState.currentState ?? 'active');
  const sub = AppState.addEventListener('change', syncRefresh);

  return () => {
    data.subscription.unsubscribe();
    sub.remove();
  };
}
