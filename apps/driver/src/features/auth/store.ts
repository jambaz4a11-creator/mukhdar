// حالة الجلسة للتطبيق كله: الجلسة (Supabase)، الملف الشخصي (الدور، التفعيل، الرمز المؤقت)، والطلب المحفوظ.
// تُقرأ عند التشغيل، ومع كل تغيّر بالجلسة، وعند كل رجوع للتطبيق (SPEC-driver §2.1).
// التجديد التلقائي للتوكن يعمل فقط والتطبيق بالواجهة (توصية Supabase لـ React Native).
import type { MukhdarClient, Session } from '@mukhdar/shared';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { clearRegistration, loadRegistration } from '../../lib/secureStore';
import type { DriverProfile, GuardState } from './guard';

export interface AuthState extends GuardState {
  session: Session | null;
}

export const useAuth = create<AuthState>(() => ({
  ready: false,
  session: null,
  profile: null,
  profileError: false,
  hasRegistration: false,
  sessionOffline: false,
}));

const PROFILE_COLUMNS = 'role, is_active, must_change_pin, full_name, phone';

/** PostgREST رفض الـ JWT (منتهٍ أو أُبطل): الجلسة لم تعد صالحة. */
function isAuthFailure(error: unknown): boolean {
  const e = error as { code?: unknown; status?: unknown };
  return e.status === 401 || (typeof e.code === 'string' && /^PGRST30\d$/.test(e.code));
}

/** رموز GoTrue التي تعني أن رمز التحديث المحفوظ لم يعد صالحاً أبداً (لا فائدة من إعادة المحاولة). */
const SESSION_GONE_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'user_not_found',
]);

/**
 * فشل `getSession()` برفض قاطع من الخادم (HTTP 400/401 أو رمز "الجلسة ضاعت"): نخرج محلياً. أي شيء آخر (شبكة،
 * `AuthRetryableFetchError`، 5xx) مؤقت: الجلسة تبقى بالجهاز ونعيد المحاولة (R1 M2).
 */
export function isDefiniteSessionRejection(error: unknown): boolean {
  const e = (error ?? {}) as { name?: unknown; status?: unknown; code?: unknown };
  if (typeof e.code === 'string' && SESSION_GONE_CODES.has(e.code)) return true;
  return e.name === 'AuthApiError' && (e.status === 400 || e.status === 401);
}

/** خروج محلي (جلسة أُبطلت: تعطيل، تخفيض دور، إعادة ضبط الرمز). لا طلب للخادم. */
async function localSignOut(client: MukhdarClient): Promise<void> {
  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // الجلسة المحلية تُمسح على أي حال
  }
  useAuth.setState({ session: null, profile: null, profileError: false, sessionOffline: false });
}

export async function refreshProfile(client: MukhdarClient): Promise<void> {
  const session = useAuth.getState().session;
  if (!session) return;
  const userId = session.user.id;
  let result: { data: unknown; error: unknown };
  try {
    result = await client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
  } catch (e) {
    result = { data: null, error: e };
  }
  // الجلسة تغيّرت أثناء القراءة (خروج/دخول آخر): لا نكتب نتيجة قديمة
  if (useAuth.getState().session?.user.id !== userId) return;
  if (result.error) {
    if (isAuthFailure(result.error)) await localSignOut(client);
    else useAuth.setState({ profileError: true });
    return;
  }
  const row = result.data as Partial<DriverProfile> | null;
  useAuth.setState({
    profileError: false,
    profile: {
      role: row?.role ?? null,
      is_active: row?.is_active === true,
      must_change_pin: row?.must_change_pin === true,
      full_name: row?.full_name ?? null,
      phone: row?.phone ?? null,
    },
  });
}

/**
 * يقرأ الجلسة المحفوظة (ويجدد رمز الوصول المنتهي). رفض قاطع ← خروج محلي. فشل مؤقت (شبكة) ← الجلسة تبقى محفوظة
 * بالجهاز و`sessionOffline` (شاشة "ماكو اتصال")؛ تُعاد المحاولة بالزر وعند كل رجوع للتطبيق.
 */
export async function loadSession(client: MukhdarClient): Promise<void> {
  try {
    const { data, error } = await client.auth.getSession();
    if (error) {
      if (isDefiniteSessionRejection(error)) {
        await localSignOut(client);
        useAuth.setState({ ready: true });
      } else {
        useAuth.setState({ session: null, sessionOffline: true, ready: true });
      }
      return;
    }
    useAuth.setState({ session: data.session, sessionOffline: false, ready: true });
  } catch {
    useAuth.setState({ session: null, sessionOffline: false, ready: true });
  }
}

/** زر "إعادة المحاولة": يعيد قراءة الجلسة ثم الملف الشخصي. */
export async function retrySession(client: MukhdarClient): Promise<void> {
  await loadSession(client);
  await refreshProfile(client);
}

export async function refreshRegistration(): Promise<void> {
  try {
    useAuth.setState({ hasRegistration: (await loadRegistration()) !== null });
  } catch {
    useAuth.setState({ hasRegistration: false });
  }
}

/** تسجيل الخروج (يبطل رمز التحديث بالخادم)؛ فشل الشبكة ← خروج محلي على أي حال. */
export async function signOut(client: MukhdarClient): Promise<void> {
  try {
    const { error } = await client.auth.signOut();
    if (error) throw error;
  } catch {
    await localSignOut(client);
    return;
  }
  useAuth.setState({ session: null, profile: null, profileError: false, sessionOffline: false });
}

/** يمسح الطلب المحفوظ من الجهاز (السر معه) ويبلّغ الحارس. الطلب على الخادم يبقى للأدمن. */
export async function forgetRegistration(): Promise<void> {
  try {
    await clearRegistration();
  } finally {
    useAuth.setState({ hasRegistration: false });
  }
}

/** يربط الحالة بالـ client، ويرجع دالة الإلغاء. client = null (بلا .env): لا جلسة. */
export function initAuth(client: MukhdarClient | null): () => void {
  if (!client) {
    void refreshRegistration().then(() => useAuth.setState({ session: null, ready: true }));
    return () => undefined;
  }

  void (async () => {
    await refreshRegistration();
    await loadSession(client);
    await refreshProfile(client);
  })();

  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (!session) {
      // INITIAL_SESSION بلا جلسة أثناء حالة "ماكو اتصال" لا تمسح العلامة (الجلسة ما زالت محفوظة بالجهاز)
      useAuth.setState((s) => ({
        session: null,
        profile: null,
        profileError: false,
        ready: true,
        sessionOffline: s.sessionOffline && event !== 'SIGNED_OUT',
      }));
      return;
    }
    const changedUser = useAuth.getState().session?.user.id !== session.user.id;
    useAuth.setState(
      changedUser
        ? { session, profile: null, profileError: false, sessionOffline: false }
        : { session, sessionOffline: false },
    );
    // لا استدعاء Supabase داخل هذه الدالة مباشرة (توصية supabase-js): نؤجله
    if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || changedUser) {
      setTimeout(() => void refreshProfile(client), 0);
    }
  });

  const syncRefresh = (state: string) => {
    if (state === 'active') {
      void client.auth.startAutoRefresh();
      // الرجوع للتطبيق: الأدمن قد يكون عطّله أو أعاد ضبط رمزه أثناء غيابه. "ماكو اتصال" تُعاد محاولتها تلقائياً.
      if (useAuth.getState().sessionOffline) void retrySession(client);
      else void refreshProfile(client);
      void refreshRegistration();
    } else void client.auth.stopAutoRefresh();
  };
  syncRefresh(AppState.currentState ?? 'active');
  const sub = AppState.addEventListener('change', syncRefresh);

  return () => {
    data.subscription.unsubscribe();
    sub.remove();
  };
}
