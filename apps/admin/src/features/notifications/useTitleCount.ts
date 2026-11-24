'use client';
// "(N) العنوان" بعنوان التبويب (T44، SPEC-admin-push §5). Next يغيّر العنوان عند كل تنقّل، فنعيد البادئة كلما تغيّر.
import { useEffect } from 'react';
import { stripCount, titleWithCount } from './tabTitle';

export function useTitleCount(count: number): void {
  useEffect(() => {
    const apply = () => {
      const next = titleWithCount(document.title, count);
      if (document.title !== next) document.title = next; // لا حلقة: القراءة التالية تطابق
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [count]);

  useEffect(
    () => () => {
      document.title = stripCount(document.title);
    },
    [],
  );
}
