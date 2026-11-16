// من المستخدم الحالي ودوره باللوحة. يُستعمل بالـ proxy وبالتخطيط (حماية مزدوجة).
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
    };

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
  return {
    state: 'ok',
    id: data.user.id,
    role: profile.role,
    name: profile.full_name,
    phone: profile.phone,
    mustChangePin: profile.must_change_pin,
  };
}
