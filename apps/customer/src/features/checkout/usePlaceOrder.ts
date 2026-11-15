// تأكيد الطلب (T13، SPEC-customer §2.4): place_order بمفتاح منع تكرار.
// المفتاح يُولَّد مرة عند أول ضغطة ويبقى (محفوظاً على الجهاز) حتى النجاح أو تغيّر السلة، فإعادة المحاولة بعد
// انقطاع أو timeout ترسل نفس المفتاح والخلفية ترجع نفس الطلب (replayed) بدل إنشاء طلب ثانٍ.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ERROR_MESSAGES,
  formatIQD,
  parseBackendError,
  type CartLine,
  type ErrorCode,
  type PlaceOrderResult,
} from '@mukhdar/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { APP_SETTINGS_KEY } from '../settings/useAppSettings';
import { cartSignature, useCart } from '../cart/store';
import { useSelectedAddress } from '../addresses/selected';

/** بعدها نعتبر الطلب منقطعاً (الرد قد يصل للخلفية؛ إعادة المحاولة بنفس المفتاح آمنة). */
export const PLACE_ORDER_TIMEOUT_MS = 20_000;
export const ORDER_NOTE_MAX = 300;

interface AttemptState {
  key: string | null;
  signature: string | null;
  /** المفتاح الحالي للسلة؛ مفتاح جديد إن تغيّرت السلة أو لم يوجد. */
  keyFor: (signature: string) => string;
  reset: () => void;
}

export const useOrderAttempt = create<AttemptState>()(
  persist(
    (set, get) => ({
      key: null,
      signature: null,
      keyFor: (signature) => {
        const { key, signature: current } = get();
        if (key && current === signature) return key;
        const next = Crypto.randomUUID();
        set({ key: next, signature });
        return next;
      },
      reset: () => set({ key: null, signature: null }),
    }),
    {
      name: 'mukhdar.orderAttempt',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ key: s.key, signature: s.signature }),
    },
  ),
);

export class PlaceOrderTimeout extends Error {
  constructor() {
    super('place_order timeout');
    this.name = 'PlaceOrderTimeout';
  }
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PlaceOrderTimeout()), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export interface PlaceOrderFailure {
  code: ErrorCode | null;
  message: string;
  /** انقطاع/timeout/خطأ غير معروف: إعادة المحاولة بنفس المفتاح */
  retryable: boolean;
}

/** رسالة عربية لكل رمز من place_order (من errors.ts)، مع تفاصيل الحد الأدنى إن وُجدت. */
export function placeOrderMessage(code: ErrorCode | null, detail: string | null): string {
  if (code === null) return ar.checkout.sendFailed;
  const base = ERROR_MESSAGES[code];
  if (code === 'BELOW_MIN_ORDER' && detail && /^\d+$/.test(detail)) {
    return `${base} (${formatIQD(Number(detail))})`;
  }
  return base;
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<PlaceOrderFailure | null>(null);

  async function submit({ addressId, note }: { addressId: string; note: string }) {
    const client = getSupabase();
    if (!client || sending) return;
    const items = useCart.getState().items;
    const lines: CartLine[] = Object.entries(items).map(([product_id, qty]) => ({
      product_id,
      qty,
    }));
    if (lines.length === 0) return;
    const key = useOrderAttempt.getState().keyFor(cartSignature(items));

    setSending(true);
    setFailure(null);
    try {
      const { data, error } = await withTimeout(
        client.rpc('place_order', {
          p_address_id: addressId,
          p_items: lines as unknown as never,
          p_idempotency_key: key,
          p_note: note.trim() === '' ? undefined : note.trim().slice(0, ORDER_NOTE_MAX),
        }),
        PLACE_ORDER_TIMEOUT_MS,
      );
      if (error) throw error;
      const result = data as unknown as PlaceOrderResult;

      // نجاح (أو replayed: نفس الطلب السابق): تفريغ السلة والانتقال للطلب بالمجموع الراجع من الخلفية
      useCart.getState().clear();
      useOrderAttempt.getState().reset();
      useSelectedAddress.getState().select(addressId);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      router.replace({
        pathname: '/order/[id]',
        params: {
          id: result.order_id,
          number: String(result.order_number),
          total: String(result.total_iqd),
        },
      });
    } catch (e) {
      const parsed = e instanceof PlaceOrderTimeout ? null : parseBackendError(e);
      const code = parsed?.code ?? null;
      const detail = parsed?.detail ?? null;
      setFailure({ code, message: placeOrderMessage(code, detail), retryable: code === null });

      if ((code === 'INSUFFICIENT_STOCK' || code === 'PRODUCT_UNAVAILABLE') && detail) {
        // رجوع للسلة مع تعليم المنتج (SPEC-customer §2.4)
        useCart
          .getState()
          .flag(detail, code === 'INSUFFICIENT_STOCK' ? 'insufficient' : 'unavailable');
        void queryClient.invalidateQueries({ queryKey: ['products'] });
        router.navigate('/cart');
      } else if (code === 'STORE_CLOSED' || code === 'BELOW_MIN_ORDER') {
        void queryClient.invalidateQueries({ queryKey: APP_SETTINGS_KEY });
      } else if (code === 'ADDRESS_INACTIVE' || code === 'ADDRESS_NOT_FOUND') {
        void queryClient.invalidateQueries({ queryKey: ['addresses'] });
      }
      setSending(false);
    }
  }

  return { submit, sending, failure };
}
