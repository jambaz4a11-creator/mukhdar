import type { Metadata } from 'next';
import { StockScreen } from '@/features/catalog/StockScreen';

export const metadata: Metadata = { title: 'المخزون' };

export default function Page() {
  return <StockScreen />;
}
