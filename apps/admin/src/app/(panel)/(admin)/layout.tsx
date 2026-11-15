import { redirect } from 'next/navigation';
import { NOT_AUTHORIZED_PATH } from '@/lib/access';
import { getPanelUser } from '@/lib/panelUser';
import { createClient } from '@/lib/supabase/server';

// صفحات الأدمن فقط (SPEC-admin §1). الموظف يُحوَّل لـ "غير مصرح" حتى لو تجاوز الـ proxy.
export default async function AdminOnlyLayout({ children }: { children: React.ReactNode }) {
  const user = await getPanelUser(await createClient());
  if (user.state !== 'ok' || user.role !== 'admin') redirect(NOT_AUTHORIZED_PATH);
  return children;
}
