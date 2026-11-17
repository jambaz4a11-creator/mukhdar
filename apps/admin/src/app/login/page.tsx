import type { Metadata } from 'next';
import { safeNext } from '@/lib/access';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-control bg-primary text-white">
            <LeafIcon />
          </span>
          <span className="flex flex-col">
            <span className="text-lg font-bold text-primary">المخضر</span>
            <span className="text-xs text-text-muted">لوحة الإدارة</span>
          </span>
        </div>
        <h1 className="mb-1 text-2xl font-bold">تسجيل الدخول</h1>
        <p className="mb-6 text-sm text-text-muted">برقم الهاتف ورمز الدخول (6 أرقام).</p>
        {reason === 'idle' && (
          <p
            role="status"
            data-testid="idle-notice"
            className="mb-4 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text"
          >
            انتهت جلستك لأنك لم تستعمل اللوحة أكثر من 12 ساعة. سجّل الدخول من جديد.
          </p>
        )}
        <LoginForm next={safeNext(next)} />
        <p className="mt-6 text-xs leading-6 text-text-muted">
          نسيت الرمز؟ راسل مدير المتجر من نفس الرقم ليعيد ضبطه. لا يوجد إنشاء حساب من اللوحة.
        </p>
      </div>
    </main>
  );
}

function LeafIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z" />
      <path d="M5 19l8-8" />
    </svg>
  );
}
