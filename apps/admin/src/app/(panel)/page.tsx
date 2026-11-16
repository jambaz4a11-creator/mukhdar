import type { Metadata } from 'next';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';

export const metadata: Metadata = { title: 'الرئيسية' };

export default function Page() {
  return <DashboardScreen />;
}
