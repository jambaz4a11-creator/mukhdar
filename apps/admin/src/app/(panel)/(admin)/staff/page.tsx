import type { Metadata } from 'next';
import { StaffScreen } from '@/features/admin/StaffScreen';

export const metadata: Metadata = { title: 'الموظفون والسائقون' };

export default function Page() {
  return <StaffScreen />;
}
