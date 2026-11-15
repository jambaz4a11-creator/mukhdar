// السلة (Zustand + حفظ على الجهاز). T11 أنشأها لعداد الكمية وشريط السلة؛ T13 أضاف الحذف والتعليمات.
// تخزن product_id والكمية فقط (SPEC-customer §2.3). الكمية عدد صحيح من وحدات البيع 1..99:
// كل ضغطة = وحدة بيع واحدة (نص كيلو للخضار والفواكه، باقة للأعشاب).
// flags: منتجات علّمتها place_order (INSUFFICIENT_STOCK / PRODUCT_UNAVAILABLE من detail)؛ لا تُحفظ،
// وتُمسح عند تغيير كمية المنتج أو حذفه.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const MAX_QTY = 99;

export type CartFlag = 'unavailable' | 'insufficient';

export interface CartState {
  /** product_id ← الكمية (1..99) */
  items: Record<string, number>;
  flags: Record<string, CartFlag>;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  /** يضيف qty وحدة (يدمج مع الموجود، والحد 99). */
  add: (productId: string, qty?: number) => void;
  /** 0 أو أقل يحذف البند؛ أكثر من 99 يُقص إلى 99. */
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  flag: (productId: string, flag: CartFlag) => void;
}

function withQty(items: Record<string, number>, id: string, qty: number): Record<string, number> {
  const n = Math.min(MAX_QTY, Math.trunc(qty));
  if (n > 0) return { ...items, [id]: n }; // يحافظ على ترتيب الإضافة
  return Object.fromEntries(Object.entries(items).filter(([k]) => k !== id));
}

function without<T>(map: Record<string, T>, id: string): Record<string, T> {
  if (!(id in map)) return map;
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== id));
}

export const useCart = create<CartState>()(
  persist(
    (set) => {
      const update = (id: string, next: (current: number) => number) =>
        set((s) => ({
          items: withQty(s.items, id, next(s.items[id] ?? 0)),
          flags: without(s.flags, id),
        }));
      return {
        items: {},
        flags: {},
        increment: (id) => update(id, (q) => q + 1),
        decrement: (id) => update(id, (q) => q - 1),
        add: (id, qty = 1) => update(id, (q) => q + qty),
        setQty: (id, qty) => update(id, () => qty),
        remove: (id) => update(id, () => 0),
        clear: () => set({ items: {}, flags: {} }),
        flag: (id, flag) => set((s) => ({ flags: { ...s.flags, [id]: flag } })),
      };
    },
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

/** بصمة السلة (المنتجات والكميات) لمفتاح منع التكرار: تتغير فقط إن تغيّرت السلة. */
export function cartSignature(items: Record<string, number>): string {
  return Object.keys(items)
    .sort()
    .map((id) => `${id}:${items[id]}`)
    .join(',');
}
