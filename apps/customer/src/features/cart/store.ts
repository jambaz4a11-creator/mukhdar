// السلة (Zustand + حفظ على الجهاز). T11 يحتاجها لعداد الكمية وشريط السلة؛ شاشة السلة والتأكيد بـ T13.
// تخزن product_id والكمية فقط (SPEC-customer §2.3). الكمية عدد صحيح من وحدات البيع 1..99:
// كل ضغطة = وحدة بيع واحدة (نص كيلو للخضار والفواكه، باقة للأعشاب).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const MAX_QTY = 99;

export interface CartState {
  /** product_id ← الكمية (1..99) */
  items: Record<string, number>;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  /** 0 أو أقل يحذف البند؛ أكثر من 99 يُقص إلى 99. */
  setQty: (productId: string, qty: number) => void;
  clear: () => void;
}

function withQty(items: Record<string, number>, id: string, qty: number): Record<string, number> {
  const n = Math.min(MAX_QTY, Math.trunc(qty));
  if (n > 0) return { ...items, [id]: n }; // يحافظ على ترتيب الإضافة
  return Object.fromEntries(Object.entries(items).filter(([k]) => k !== id));
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: {},
      increment: (id) => set((s) => ({ items: withQty(s.items, id, (s.items[id] ?? 0) + 1) })),
      decrement: (id) => set((s) => ({ items: withQty(s.items, id, (s.items[id] ?? 0) - 1) })),
      setQty: (id, qty) => set((s) => ({ items: withQty(s.items, id, qty) })),
      clear: () => set({ items: {} }),
    }),
    {
      name: 'mukhdar.cart',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items }),
    },
  ),
);

export function useCartQty(productId: string): number {
  return useCart((s) => s.items[productId] ?? 0);
}
