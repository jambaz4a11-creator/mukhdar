import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CHANGE_PIN_PATH, LOGIN_PATH, NOT_AUTHORIZED_PATH, safeNext } from '@/lib/access';
import { getPanelUser, pinBeforeMfa } from '@/lib/panelUser';
import { createClient } from '@/lib/supabase/server';
import { ServiceUnavailable } from '@/components/ServiceUnavailable';
import { MfaForm } from './MfaForm';

export const metadata: Metadata = { title: 'المصادقة الثنائية' };

// T23 C1: خارج تخطيط اللوحة (بلا قائمة). الـ proxy يحوّل هنا كل صفحة ما دامت الجلسة aal1،
// ويحوّل من هنا للوجهة بعد اكتمالها.
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getPanelUser(await createClient());
  if (user.state === 'unavailable') return <ServiceUnavailable />;
  if (user.state === 'anonymous') redirect(LOGIN_PATH);
  if (user.state === 'forbidden') redirect(NOT_AUTHORIZED_PATH);
  // T23 F M2: لا تسجيل لتطبيق المصادقة برمز مؤقت: تغيير الرمز أولاً
  if (pinBeforeMfa(user)) redirect(CHANGE_PIN_PATH);
  const { next } = await searchParams;
  const target = safeNext(next);

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6">
        <h1 className="mb-1 text-2xl font-bold">المصادقة الثنائية</h1>
        {user.hasTotp ? (
          <p className="mb-5 text-sm leading-6 text-text-muted">
            اكتب الرمز من 6 أرقام الظاهر الآن بتطبيق المصادقة على هاتفك.
          </p>
        ) : (
          <p data-testid="mfa-enroll-intro" className="mb-5 text-sm leading-6 text-text-muted">
            حساب الإدارة يحتاج تطبيق مصادقة (مثل Google Authenticator أو Microsoft Authenticator).
            امسح الرمز بالتطبيق، أو اكتب المفتاح يدوياً، ثم اكتب الرمز الذي يظهر.
          </p>
        )}
        <MfaForm enrolled={user.hasTotp} next={target === '/mfa' ? '/' : target} />
        <p className="mt-6 text-xs leading-6 text-text-muted">
          فقدت هاتفك أو التطبيق؟ الموظف: راسل المدير ليعيد ضبط المصادقة من صفحة الموظفين. المدير:
          إجراء الطوارئ بدليل التشغيل.
        </p>
      </div>
    </main>
  );
}
