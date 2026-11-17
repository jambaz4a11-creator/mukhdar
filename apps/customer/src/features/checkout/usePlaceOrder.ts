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
import { useAuth } from '../auth/store';
import { askAfterFirstOrder } from '../notifications/push';

/** بعدها نعتبر الطلب منقطعاً (الرد قد يصل للخلفية؛ إعادة المحاولة بنفس المفتاح آمنة). */
export const PLACE_ORDER_TIMEOUT_MS = 20_000;
export const ORDER_NOTE_MAX = 300;

/**
 * عمر المفتاح: بعده يُولَّد مفتاح جديد حتى لو لم تتغير السلة. بدونه، محاولة وصلت للخادم وانقطع ردها ثم رجع
 * الزبون بنفس السلة بعد أيام ← place_order يعيد الطلب القديم (replayed) كأنه نجاح ولا يُنشأ طلب جديد.
 * إعادة المحاولة الحقيقية بعد انقطاع تحدث خلال دقائق.
 */
export const ORDER_KEY_TTL_MS = 30 * 60 * 1000;

interface AttemptState {
  key: string | null;
  signature: string | null;
  /** وقت توليد المفتاح (ms) */
  createdAt: number | null;
  /** المفتاح الحالي للسلة؛ مفتاح جديد إن تغيّرت السلة أو لم يوجد أو انتهى عمره. */
  keyFor: (signature: string, now?: number) => string;
  reset: () => void;
}

export const useOrderAttempt = create<AttemptState>()(
  persist(
    (set, get) => ({
      key: null,
      signature: null,
      createdAt: null,
      keyFor: (signature, now = Date.now()) => {
        const { key, signature: current, createdAt } = get();
        const fresh = createdAt !== null && now - createdAt < ORDER_KEY_TTL_MS;
        if (key && current === signature && fresh) return key;
        const next = Crypto.randomUUID();
        set({ key: next, signature, createdAt: now });
        return next;
      },
      reset: () => set({ key: null, signature: null, createdAt: null }),
    }),
    {
      name: 'mukhdar.orderAttempt',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ key: s.key, signature: s.signature, createdAt: s.createdAt }),
      // نسخة 1 بلا createdAt: المفتاح القديم يُعد منتهياً (يُولَّد جديد)
      migrate: () => ({ key: null, signature: null, createdAt: null }),
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

/** رسالة عربية لكل رمز من place_order (من errors.ts)، مع تفاصيل الحد (الأدنى، أو حدّا الطلب T23 H2) إن وُجدت. */
export function placeOrderMessage(code: ErrorCode | null, detail: string | null): string {
  if (code === null) return ar.checkout.sendFailed;
  const base = ERROR_MESSAGES[code];
  const limit = detail && /^\d+$/.test(detail) ? Number(detail) : null;
  if (limit === null) return base;
  // T23 H2: الحساب الجديد (بلا طلب مُسلَّم) طلب مفتوح واحد فقط
  if (code === 'TOO_MANY_ACTIVE_ORDERS' && limit === 1) return ar.checkout.oneActiveOrder;
  if (code === 'BELOW_MIN_ORDER') return `${base} (${formatIQD(limit)})`;
  if (code === 'QTY_LIMIT') return `${base} ${ar.checkout.qtyLimit(limit)}`;
  if (code === 'TOO_MANY_ITEMS') return `${base} ${ar.checkout.linesLimit(limit)}`;
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
      void queryClient.invalidateQueries({ queryKey: ['orders'] }); // "طلباتي" تعرض الطلب الجديد
      router.replace({
        pathname: '/order/[id]',
        params: {
          id: result.order_id,
          number: String(result.order_number),
          total: String(result.total_iqd),
        },
      });
      // T14: إذن الإشعارات بعد أول طلب ناجح (مرة واحدة بالجهاز، مع شرح)
      void askAfterFirstOrder(client);
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
      } else if (code === 'PIN_CHANGE_REQUIRED') {
        // رمز مؤقت لم تلتقطه القراءة (لا شبكة وقتها، أو أعاد المتجر الضبط الآن): الحارس يفتح شاشة التغيير (M3)
        useAuth.setState({ mustChangePin: true });
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
