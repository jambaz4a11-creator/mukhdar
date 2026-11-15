import type { Metadata } from 'next';
import { signOut } from '../actions';

export const metadata: Metadata = { title: 'غير مصرح' };

export default function NotAuthorizedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-6 text-center">
        <h1 className="mb-2 text-2xl font-bold text-danger">غير مصرح</h1>
        <p className="mb-6 text-sm leading-7 text-text-muted">
          حسابك ما عنده صلاحية لهذه الصفحة. اللوحة للإدارة والموظفين فقط؛ الزبائن يستخدمون تطبيق
          المخضر.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href="/"
            className="flex h-11 items-center rounded-control border border-border px-4 font-medium"
          >
            الرئيسية
          </a>
          <form action={signOut}>
            <button
              type="submit"
              className="h-11 rounded-control bg-primary px-4 font-medium text-white"
            >
              تسجيل الخروج
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
