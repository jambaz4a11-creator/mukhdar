// خمول اللوحة (T23 F M4): الجلسة الخاملة > 12 ساعة يرفضها الخادم، لكن RLS يرجع لها قوائم فارغة (لا خطأ).
// لذلك لا تُعرض قائمة طلبات فارغة قبل التأكد أن الجلسة حيّة (panel_session_alive: قراءة فقط، لا تمدد الجلسة)،
// والجلسة المنتهية تخرج إلى صفحة الدخول برسالة الخمول.
import type { MukhdarClient } from '@mukhdar/shared';
import { LOGIN_PATH } from './access';

export const IDLE_LOGIN_URL = `${LOGIN_PATH}?reason=idle`;

/** الجلسة انتهت بالخادم (خمول 12 ساعة أو لم تعد aal2). */
export class PanelSessionExpiredError extends Error {
  constructor() {
    super('SESSION_EXPIRED');
    this.name = 'PanelSessionExpiredError';
  }
}

type RpcClient = Pick<MukhdarClient, 'rpc'>;

/** true حيّة، false انتهت، null لم نعرف (انقطاع لحظي: لا نُخرج أحداً). */
export async function isPanelSessionAlive(client: RpcClient): Promise<boolean | null> {
  try {
    const { data, error } = await client.rpc('panel_session_alive');
    if (error || typeof data !== 'boolean') return null;
    return data;
  } catch {
    return null;
  }
}

/** يرمي PanelSessionExpiredError إن كانت الجلسة منتهية؛ يُستدعى قبل عرض نتيجة فارغة. */
export async function assertPanelSessionAlive(client: RpcClient): Promise<void> {
  if ((await isPanelSessionAlive(client)) === false) throw new PanelSessionExpiredError();
}

let leaving = false;

/** خروج محلي ثم صفحة الدخول برسالة الخمول (مرة واحدة حتى لو تعددت الاستدعاءات). */
export async function leaveExpiredSession(
  client: Pick<MukhdarClient, 'auth'>,
  go: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  if (leaving) return;
  leaving = true;
  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // الخروج المحلي يمسح الـ cookies؛ فشله لا يمنع الانتقال (الخادم يرفض الجلسة أصلاً)
  }
  go(IDLE_LOGIN_URL);
}

/** للاختبارات فقط. */
export function resetLeavingForTests() {
  leaving = false;
}
