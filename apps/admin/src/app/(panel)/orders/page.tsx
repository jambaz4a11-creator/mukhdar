import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrdersScreen } from '@/features/orders/OrdersScreen';

export const metadata: Metadata = { title: 'الطلبات' };

export default function OrdersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-text-muted">جارٍ التحميل…</p>}>
      <OrdersScreen />
    </Suspense>
  );
}
