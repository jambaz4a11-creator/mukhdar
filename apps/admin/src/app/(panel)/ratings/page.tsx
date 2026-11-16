import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RatingsScreen } from '@/features/ratings/RatingsScreen';

export const metadata: Metadata = { title: 'التقييمات' };

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-text-muted">جارٍ التحميل…</p>}>
      <RatingsScreen />
    </Suspense>
  );
}
