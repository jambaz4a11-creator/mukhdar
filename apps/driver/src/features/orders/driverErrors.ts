// R1 L6 (SPEC-driver §2.6): `NOT_ALLOWED` من أي دالة سائق (available_orders، accept_order، set_order_status،
// register_push_token) لا يُعرض كرسالة خطأ وحدها. الحارس قد يكون أرسل جلسة ملفها الشخصي غير مقروء للتبويبات
// (القاعدة هي الحَكَم وترفض غير السائق)، فنعيد قراءة الملف والحارس يحوّل لـ `not-driver` أو `change-pin`.
import type { MukhdarClient } from '@mukhdar/shared';
import { refreshProfile } from '../auth/store';

/** هل رمز الخطأ يعني "لست سائقاً فعّالاً الآن" (إعادة فحص الحارس)؟ NOT_AUTHENTICATED: set_order_status لحساب مؤشَّر. */
export function isDriverAccessError(code: string | null | undefined): boolean {
  return code === 'NOT_ALLOWED' || code === 'NOT_AUTHENTICATED';
}

/** يعيد قراءة الملف الشخصي؛ الحارس (AuthGuard) يتفاعل مع الحالة الجديدة ويوجّه. */
export async function guardDriverError(client: MukhdarClient): Promise<void> {
  await refreshProfile(client);
}
