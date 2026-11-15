import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'التقارير والأرباح' };

export default function Page() {
  return (
    <Placeholder title="التقارير والأرباح" task="T20">
      المبيعات وصافي الربح والهدر وأكثر المنتجات مبيعاً.
    </Placeholder>
  );
}
