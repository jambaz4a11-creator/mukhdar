import type { Metadata } from 'next';
import { WasteScreen } from '@/features/catalog/WasteScreen';

export const metadata: Metadata = { title: 'هدر اليوم' };

export default function Page() {
  return <WasteScreen />;
}
