import type { Metadata } from 'next';
import { StaffScreen } from '@/features/admin/StaffScreen';

export const metadata: Metadata = { title: 'الموظفون والسواق' };

export default function Page() {
  return <StaffScreen />;
}
