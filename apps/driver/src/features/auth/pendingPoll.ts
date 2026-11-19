// حالة طلب التسجيل (SPEC-driver §2.4، §4.3): RPC driver_request_status بالمفتاح المنشور (دور anon، بلا جلسة).
// يُستطلع عند فتح الشاشة، كل 30 ثانية والشاشة ظاهرة والتطبيق بالواجهة، عند الرجوع للتطبيق، وبالزر.
import type { MukhdarClient } from '@mukhdar/shared';
import { AppState } from 'react-native';
import type { Registration } from '../../lib/secureStore';

export const POLL_INTERVAL_MS = 30_000;

export type RequestStatus =
  'pending' | 'approved' | 'rejected' | 'expired' | 'completed' | 'not_found';

/** ماذا تفعل الشاشة: تبقى، تنتقل، أو تعرض حالة نهائية. null = قيمة غير معروفة (تُعامل كخطأ). */
export type PendingOutcome = 'pending' | 'set-pin' | 'rejected' | 'expired' | 'login' | 'register';

const OUTCOMES: Record<RequestStatus, PendingOutcome> = {
  pending: 'pending',
  approved: 'set-pin',
  rejected: 'rejected',
  expired: 'expired',
  // اكتمل من هذا الجهاز سابقاً ثم انقطع قبل الدخول
  completed: 'login',
  // سر لا يطابق أو حُذف الطلب
  not_found: 'register',
};

export function pendingOutcome(status: string): PendingOutcome | null {
  return Object.prototype.hasOwnProperty.call(OUTCOMES, status)
    ? OUTCOMES[status as RequestStatus]
    : null;
}

/** يرمي عند فشل الطلب (الشاشة تعرض رسالة الشبكة وتبقى). */
export async function fetchRequestStatus(
  client: MukhdarClient,
  reg: Pick<Registration, 'requestId' | 'secret'>,
): Promise<string> {
  const { data, error } = await client.rpc('driver_request_status', {
    p_request_id: reg.requestId,
    p_device_secret: reg.secret,
  });
  if (error) throw error;
  return String(data);
}

interface AppStateLike {
  currentState: string | null;
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

/**
 * يستدعي check فوراً، ثم كل intervalMs ما دام التطبيق بالواجهة، وفوراً عند الرجوع له. يرجع دالة الإيقاف
 * (الشاشة تستدعيها عند الاختفاء عبر useFocusEffect).
 */
export function startPendingPoll(
  check: () => void,
  { intervalMs = POLL_INTERVAL_MS, appState = AppState as unknown as AppStateLike } = {},
): () => void {
  // 'unknown' (أول تشغيل، بعض البيئات) = بالواجهة؛ يتوقف فقط بالخلفية
  const isForeground = (state: string | null) => state !== 'background' && state !== 'inactive';
  let active = isForeground(appState.currentState);
  if (active) check();
  const timer = setInterval(() => {
    if (active) check();
  }, intervalMs);
  const sub = appState.addEventListener('change', (next: string) => {
    const was = active;
    active = isForeground(next);
    if (active && !was) check();
  });
  return () => {
    clearInterval(timer);
    sub.remove();
  };
}
