import type { Metadata } from 'next';
import { CashScreen } from '@/features/cash/CashScreen';

export const metadata: Metadata = { title: 'تسليم الكاش' };

export default function Page() {
  return <CashScreen />;
}
