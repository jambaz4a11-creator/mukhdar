'use client';

import { retryTarget } from '@/lib/access';

// تعذّر التحقق من الجلسة بسبب خلل خادم أو شبكة (ليست جلسة منتهية). الوصول يبقى ممنوعاً، والموظف يعيد المحاولة
// بدل أن يُرمى لصفحة الدخول.

export function ServiceUnavailable() {
  const retry = () => {
    const target = retryTarget(window.location.pathname);
    if (target) window.location.assign(target);
    else window.location.reload();
  };
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div
        role="alert"
        data-testid="service-unavailable"
        className="w-full max-w-md rounded-card border border-border bg-surface p-6 text-center"
      >
        <h1 className="mb-2 text-2xl font-bold text-danger">صار خلل، حاول مرة ثانية</h1>
        <p className="mb-6 text-sm leading-7 text-text-muted">
          تعذّر الاتصال بالخادم للتحقق من جلستك. ما انسجلت خروجك؛ اضغط إعادة المحاولة.
        </p>
        <button
          type="button"
          onClick={retry}
          className="h-11 rounded-control bg-primary px-4 font-medium text-white"
        >
          إعادة المحاولة
        </button>
      </div>
    </main>
  );
}
