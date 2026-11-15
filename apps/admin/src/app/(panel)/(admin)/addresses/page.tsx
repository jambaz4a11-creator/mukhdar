import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'العناوين' };

export default function Page() {
  return (
    <Placeholder title="العناوين" task="T19">
      قطاع ← وحدة ← عمارة، وإضافة عمارات بالجملة.
    </Placeholder>
  );
}
