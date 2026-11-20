// حسابي (SPEC-driver §2.10): الخروج وحذف الحساب.
import { parseFunctionError, type MukhdarClient } from '@mukhdar/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ar } from '../../i18n/ar';
import { PUSH_TOKEN_KEY, unregisterPushToken } from '../../lib/push';
import { signOut } from '../auth/store';

export type SignOutResult = { ok: true } | { ok: false; message: string };

/**
 * الخروج بالترتيب (DRIVER-API §3.4): حذف صف push_tokens لهذا الجهاز ← إلغاء اشتراكات Realtime ← signOut.
 * فشل حذف الرمز (شبكة) ← لا نخرج بصمت: تبقى الجلسة ويُعرض خطأ، فلا تصل إشعارات الحساب لجهاز خرج منه.
 */
export async function signOutDriver(client: MukhdarClient): Promise<SignOutResult> {
  if (!(await unregisterPushToken(client))) {
    return { ok: false, message: ar.account.signOutFailed };
  }
  try {
    await client.removeAllChannels();
  } catch {
    // الاشتراكات تسقط مع الجلسة على أي حال
  }
  await signOut(client);
  return { ok: true };
}

export type DeleteResult = { ok: true } | { ok: false; message: string };

/** delete-account (POST بجلسة المستخدم). ACTIVE_ORDER ← رسالة السائق؛ النجاح ← مسح رمز الجهاز محلياً وخروج محلي. */
export async function deleteDriverAccount(client: MukhdarClient): Promise<DeleteResult> {
  try {
    const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      const parsed = await parseFunctionError(error);
      return {
        ok: false,
        message: parsed.code === 'ACTIVE_ORDER' ? ar.account.deleteActiveOrder : parsed.message,
      };
    }
  } catch (e) {
    return { ok: false, message: (await parseFunctionError(e)).message };
  }
  // الحساب حُذف (والخادم حذف رموزه): لا داعي لطلب خروج من الخادم
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // الجلسة المحلية لن تعمل على أي حال (المستخدم حُذف)
  }
  try {
    await client.removeAllChannels();
  } catch {
    // لا شيء
  }
  return { ok: true };
}
