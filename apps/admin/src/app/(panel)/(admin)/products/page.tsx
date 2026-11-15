import type { Metadata } from 'next';
import { ProductsScreen } from '@/features/catalog/ProductsScreen';

export const metadata: Metadata = { title: 'المنتجات والمخزون' };

export default function Page() {
  return <ProductsScreen />;
}
