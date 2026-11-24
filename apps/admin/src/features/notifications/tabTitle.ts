// عدّاد الطلبات الجديدة بعنوان التبويب (T44، SPEC-admin-push §5، افتراض A6): "(3) الطلبات · لوحة سوق بسماوي".
const PREFIX = /^\(\d+\+?\) /;

export function stripCount(title: string): string {
  return title.replace(PREFIX, '');
}

export function titleWithCount(title: string, count: number): string {
  const base = stripCount(title);
  if (!Number.isFinite(count) || count < 1) return base;
  const n = Math.floor(count);
  return `(${n > 99 ? '99+' : n}) ${base}`;
}
