import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'الطلبات' };

export default function Page() {
  return (
    <Placeholder title="الطلبات" task="T17">
      تبويبات بالحالة، جدول الطلبات، التفاصيل والطباعة، وتحديث حي.
    </Placeholder>
  );
}
