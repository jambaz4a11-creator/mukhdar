'use client';
import { useEffect } from 'react';

/** يفتح نافذة الطباعة مرة عند الفتح، وزر لإعادة الطباعة (لا يُطبع). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <button type="button" className="no-print" onClick={() => window.print()}>
      طباعة
    </button>
  );
}
