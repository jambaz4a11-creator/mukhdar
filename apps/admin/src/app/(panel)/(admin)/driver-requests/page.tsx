import type { Metadata } from 'next';
import { DriverRequestsScreen } from '@/features/driverRequests/DriverRequestsScreen';

export const metadata: Metadata = { title: 'طلبات السواق' };

export default function Page() {
  return <DriverRequestsScreen />;
}
