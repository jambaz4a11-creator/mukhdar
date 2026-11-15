import { redirect } from 'next/navigation';
import { LOGIN_PATH, NOT_AUTHORIZED_PATH, navItems } from '@/lib/access';
import { getPanelUser } from '@/lib/panelUser';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';

// حماية ثانية بعد الـ proxy: لا تُعرض صفحات اللوحة لغير الأدمن والموظف.
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const user = await getPanelUser(supabase);
  if (user.state === 'anonymous') redirect(LOGIN_PATH);
  if (user.state === 'forbidden') redirect(NOT_AUTHORIZED_PATH);

  // شارة الطلبات: عدد الجديدة (pending). التحديث الحي بـ T17.
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        items={navItems(user.role)}
        role={user.role}
        name={user.name}
        pendingOrders={count ?? 0}
      />
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">{children}</div>
      </main>
    </div>
  );
}
