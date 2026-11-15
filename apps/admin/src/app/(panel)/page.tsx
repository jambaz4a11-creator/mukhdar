import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'الرئيسية' };

export default function Page() {
  return (
    <Placeholder title="الرئيسية" task="T25">
      مؤشرات اليوم (المبيعات، الطلبات المكتملة والملغاة، صافي الربح…) وطلبات اليوم. الموظف يراها بلا
      مبالغ.
    </Placeholder>
  );
}
