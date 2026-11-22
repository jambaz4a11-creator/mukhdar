// حسابي (SPEC-driver §2.10): الخروج وحذف الحساب.
import { parseFunctionError, type MukhdarClient } from '@mukhdar/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ar } from '../../i18n/ar';
import { PUSH_TOKEN_KEY } from '../../lib/push';
import { fetchCashSummary } from '../cash/cash';
import { groupDigits } from '../today/date';

export type DeleteResult = { ok: true } | { ok: false; message: string };

/** رد الدالة لا يحمل المبلغ (409 {error}): نقرأه من driver_cash_summary؛ تعذّرت القراءة ← رسالة بلا مبلغ. */
async function cashOutstandingMessage(client: MukhdarClient): Promise<string> {
  const summary = await fetchCashSummary(client);
  if (!summary.ok || summary.summary.outstanding_iqd <= 0) {
    return ar.account.deleteCashOutstandingNoAmount;
  }
  return ar.account.deleteCashOutstanding(`${groupDigits(summary.summary.outstanding_iqd)} د.ع`);
}

/** delete-account (POST بجلسة المستخدم). ACTIVE_ORDER ← رسالة السائق؛ النجاح ← مسح رمز الجهاز محلياً وخروج محلي. */
export async function deleteDriverAccount(client: MukhdarClient): Promise<DeleteResult> {
  try {
    const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      const parsed = await parseFunctionError(error);
      if (parsed.code === 'CASH_OUTSTANDING') {
        return { ok: false, message: await cashOutstandingMessage(client) };
      }
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
