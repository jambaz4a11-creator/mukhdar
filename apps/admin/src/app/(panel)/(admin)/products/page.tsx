import type { Metadata } from 'next';
import Link from 'next/link';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'المنتجات والمخزون' };

export default function Page() {
  return (
    <Placeholder title="المنتجات والمخزون" task="T18">
      <p>الأقسام بالصور، وجدول المنتجات بالسعر والكلفة لكل كيلو.</p>
      <Link
        href="/stock"
        className="mt-3 inline-flex min-h-11 items-center rounded-control border border-border px-4 font-medium"
      >
        المخزون
      </Link>
    </Placeholder>
  );
}
