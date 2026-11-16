import type { Metadata } from 'next';
import { ReportsScreen } from '@/features/reports/ReportsScreen';

export const metadata: Metadata = { title: 'التقارير والأرباح' };

export default function Page() {
  return <ReportsScreen />;
}
