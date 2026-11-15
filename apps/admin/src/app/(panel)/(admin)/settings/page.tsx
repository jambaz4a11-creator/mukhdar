import type { Metadata } from 'next';
import Link from 'next/link';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'الإعدادات والموظفون' };

export default function Page() {
  return (
    <Placeholder title="الإعدادات والموظفون" task="T19">
      <p>أجرة التوصيل، الحد الأدنى للطلب، فتح وغلق المتجر.</p>
      <ul className="mt-3 flex flex-wrap gap-3">
        <li>
          <Link
            href="/staff"
            className="flex min-h-11 items-center rounded-control border border-border px-4 font-medium"
          >
            الموظفون والسواق
          </Link>
        </li>
        <li>
          <Link
            href="/addresses"
            className="flex min-h-11 items-center rounded-control border border-border px-4 font-medium"
          >
            العناوين
          </Link>
        </li>
      </ul>
    </Placeholder>
  );
}
