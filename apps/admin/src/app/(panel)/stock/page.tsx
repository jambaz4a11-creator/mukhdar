import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'المخزون' };

export default function Page() {
  return (
    <Placeholder title="المخزون" task="T18">
      الأرصدة بالكيلو أو بالوحدة وتنبيه النقص. الحركات والمشتريات والتسويات للأدمن.
    </Placeholder>
  );
}
