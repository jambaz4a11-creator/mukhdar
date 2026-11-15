// صفحة هيكل: العنوان + ملاحظة المهمة التي تبني المحتوى.
export function Placeholder({
  title,
  task,
  children,
}: {
  title: string;
  task: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <header className="flex flex-col gap-0.5">
        <h1 className="text-[26px] font-bold">{title}</h1>
        <span className="text-sm text-text-muted">قيد البناء: المحتوى بالمهمة {task}.</span>
      </header>
      <section className="rounded-card border border-dashed border-border bg-surface p-6 text-sm leading-7 text-text-muted">
        {children ?? 'هذه الصفحة هيكل فارغ حالياً.'}
      </section>
    </>
  );
}
