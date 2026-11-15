import { IS_DRAFT, LEGAL_UPDATED } from '@/content/legal';

// الصفحات العامة: بلا دخول وبلا قائمة اللوحة. نص طويل بعرض مريح للقراءة.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <p className="mb-6 text-lg font-bold text-primary">المخضر</p>
      {IS_DRAFT && (
        <p
          role="note"
          data-testid="draft-banner"
          className="mb-6 rounded-control bg-warning-soft px-4 py-3 text-sm leading-7 text-warning-text"
        >
          مسودة أولى بانتظار مراجعة صاحب المتجر (ويُفضّل مراجعة قانونية). القيم بين [ ] تُستبدل قبل
          النشر.
        </p>
      )}
      <article className="legal flex flex-col gap-4 text-[15px] leading-8">{children}</article>
      <p className="mt-10 text-xs text-text-muted">
        آخر تحديث: <span className="num">{LEGAL_UPDATED}</span> · <a href="/privacy">الخصوصية</a> ·{' '}
        <a href="/terms">الشروط</a> · <a href="/delete-account">حذف الحساب</a>
      </p>
    </main>
  );
}
