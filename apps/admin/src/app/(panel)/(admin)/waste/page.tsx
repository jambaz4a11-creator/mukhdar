import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'هدر اليوم' };

export default function Page() {
  return (
    <Placeholder title="هدر اليوم" task="T18">
      كمية التالف لكل منتج وحفظ واحد.
    </Placeholder>
  );
}
