// تغيير الرمز الإجباري (مراجعة جلسة C، M3): رمز مؤقت من المتجر (profiles.must_change_pin) ← لا شاشة غير
// شاشة التغيير حتى يُغيَّر، مهما كان الدخول إليها (دخول جديد، إعادة تشغيل بجلسة محفوظة، رابط عميق، رجوع).
// قاعدة البيانات هي الحَكَم (ترفض الطلبات برمز مؤقت)؛ هذا فقط لئلا يتفاجأ الزبون عند التأكيد.
import type { MukhdarClient, Session } from '@mukhdar/shared';
import { CHANGE_PIN, safeRedirect } from './redirect';

/** قراءة العلامة؛ null إن تعذّرت (لا شبكة): نترك الحالة كما هي والخادم يرفض الطلب. */
export async function fetchMustChangePin(
  client: MukhdarClient,
  userId: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await client
      .from('profiles')
      .select('must_change_pin')
      .eq('id', userId)
      .maybeSingle();
    if (error) return null;
    return (data as { must_change_pin?: boolean } | null)?.must_change_pin === true;
  } catch {
    return null;
  }
}

export interface ForcedPinState {
  ready: boolean;
  session: Session | null;
  mustChangePin: boolean;
  pathname: string;
}

/** وجهة الإجبار، أو null إن لم يلزم (أو نحن بشاشة التغيير أصلاً). مسار الرجوع بعد التغيير = المكان المطلوب. */
export function forcedPinRedirect(state: ForcedPinState) {
  if (!state.ready || !state.session || !state.mustChangePin) return null;
  if (state.pathname === CHANGE_PIN) return null;
  return {
    pathname: CHANGE_PIN,
    params: { forced: '1', redirect: safeRedirect(state.pathname) },
  } as const;
}
