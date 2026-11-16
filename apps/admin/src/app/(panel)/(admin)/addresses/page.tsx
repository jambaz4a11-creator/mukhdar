import type { Metadata } from 'next';
import { AddressesScreen } from '@/features/admin/AddressesScreen';

export const metadata: Metadata = { title: 'العناوين' };

export default function Page() {
  return <AddressesScreen />;
}
