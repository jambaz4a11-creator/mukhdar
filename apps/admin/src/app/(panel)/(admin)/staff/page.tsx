import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'الموظفون والسواق' };

export default function Page() {
  return (
    <Placeholder title="الموظفون والسواق" task="T19">
      إضافة موظف أو سائق، تغيير الدور، إعادة ضبط رمز الدخول.
    </Placeholder>
  );
}
