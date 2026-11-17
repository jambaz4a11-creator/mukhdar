// من المستخدم الحالي ودوره باللوحة ومستوى جلسته (aal). يُستعمل بالـ proxy وبالتخطيط (حماية مزدوجة).
import type { MukhdarClient } from '@mukhdar/shared';
import { isPanelRole, type PanelRole } from './access';

export type PanelUser =
  | { state: 'anonymous' }
  | { state: 'forbidden' } // زبون، سائق، أو حساب معطّل
  | {
      state: 'ok';
      id: string;
      role: PanelRole;
      name: string | null;
      phone: string | null;
      /** رمز مؤقت (admin-create-user / admin-reset-pin): لا صفحة غير "تغيير الرمز" حتى يُغيَّر. */
      mustChangePin: boolean;
      /**
       * المصادقة الثنائية (T23 C1): الجلسة ليست aal2 بعد (الـ PIN وحده). قاعدة البيانات ترفض كل دوال
       * الأدمن/الموظف بهذه الجلسة، فكل صفحة تحوّل لـ /mfa.
       */
      mfaRequired: boolean;
      /** عنده عامل TOTP مُفعَّل: /mfa تطلب الرمز؛ وإلا تعرض التسجيل (QR + المفتاح). */
      hasTotp: boolean;
    };

type AuthUser = { factors?: { factor_type: string; status: string }[] | null };

export function hasVerifiedTotp(user: AuthUser): boolean {
  return (user.factors ?? []).some((f) => f.factor_type === 'totp' && f.status === 'verified');
}

/**
 * T23 F M2: رمز مؤقت ولا عامل TOTP بعد ← تغيير الرمز يسبق تسجيل تطبيق المصادقة (proxy وصفحتا /mfa و/change-pin).
 * بعد التغيير: الجلسة aal1 بلا عامل ← /mfa للتسجيل.
 */
export function pinBeforeMfa(user: { mustChangePin: boolean; hasTotp: boolean }): boolean {
  return user.mustChangePin && !user.hasTotp;
}

export async function getPanelUser(
  supabase: Pick<MukhdarClient, 'auth' | 'from'>,
): Promise<PanelUser> {
  // getUser يتحقق من الرمز عند Supabase (لا نثق بـ cookie غير مُتحقق منه).
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { state: 'anonymous' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active, full_name, phone, must_change_pin')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active || !isPanelRole(profile.role)) return { state: 'forbidden' };
  // مستوى الجلسة من نفس الرمز الذي تحقق منه getUser أعلاه
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    state: 'ok',
    id: data.user.id,
    role: profile.role,
    name: profile.full_name,
    phone: profile.phone,
    mustChangePin: profile.must_change_pin,
    mfaRequired: aal?.currentLevel !== 'aal2',
    hasTotp: hasVerifiedTotp(data.user),
  };
}
