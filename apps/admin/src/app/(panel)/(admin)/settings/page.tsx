import type { Metadata } from 'next';
import { SettingsScreen } from '@/features/admin/SettingsScreen';

export const metadata: Metadata = { title: 'الإعدادات والموظفون' };

export default function Page() {
  return <SettingsScreen />;
}
