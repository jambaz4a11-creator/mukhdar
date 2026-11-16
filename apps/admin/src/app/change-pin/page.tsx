import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LOGIN_PATH, NOT_AUTHORIZED_PATH } from '@/lib/access';
import { getPanelUser } from '@/lib/panelUser';
import { createClient } from '@/lib/supabase/server';
import { ChangePinForm } from './ChangePinForm';

export const metadata: Metadata = { title: 'تغيير رمز الدخول' };

// خارج تخطيط اللوحة: برمز مؤقت لا تظهر القائمة (كل صفحة أخرى تحوّل هنا، proxy.ts).
export default async function ChangePinPage() {
  const user = await getPanelUser(await createClient());
  if (user.state === 'anonymous') redirect(LOGIN_PATH);
  if (user.state === 'forbidden') redirect(NOT_AUTHORIZED_PATH);

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6">
        <h1 className="mb-1 text-2xl font-bold">تغيير رمز الدخول</h1>
        {user.mustChangePin ? (
          <p
            data-testid="pin-forced"
            className="mb-5 rounded-control bg-warning-soft px-3 py-2 text-sm leading-6"
          >
            رمزك الحالي مؤقت (من المدير). اختر رمزاً جديداً من 6 أرقام لا يعرفه غيرك قبل المتابعة.
          </p>
        ) : (
          <p className="mb-5 text-sm text-text-muted">
            اكتب رمزك الحالي، ثم رمزاً جديداً من 6 أرقام. أجهزتك الأخرى تخرج بعد التغيير.
          </p>
        )}
        <ChangePinForm phone={user.phone} forced={user.mustChangePin} />
      </div>
    </main>
  );
}
