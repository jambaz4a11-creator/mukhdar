import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'التقييمات' };

export default function Page() {
  return (
    <Placeholder title="التقييمات" task="T26">
      المتوسط وتوزيع النجوم وقائمة التقييمات.
    </Placeholder>
  );
}
