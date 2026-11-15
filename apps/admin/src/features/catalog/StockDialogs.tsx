'use client';
// نوافذ حركات المخزون (أدمن، SPEC-admin §2.3): مشتريات بسعر شراء، تسوية جرد بملاحظة، وحد النقص.
// الإدخال بالكيلو (خطوة 0.5) لنص الكيلو وبالوحدة للباقي؛ قاعدة البيانات تستقبل وحدات البيع.
import {
  adminUnitLabel,
  errorMessage,
  formatAdminQuantity,
  formatIQD,
  toAdminQty,
} from '@mukhdar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { adjustStock, catalogKeys, saveProduct, type Product } from './api';
import { priceLabel, validateAdjust, validatePurchase, validateThreshold } from './forms';
import { Field, Modal, inputClass } from './ui';

function useDone(onClose: () => void) {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: catalogKeys.all });
    onClose();
  };
}

const submitClass =
  'h-12 rounded-control bg-primary text-[15px] font-bold text-white disabled:opacity-60';

function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
      {errorMessage(error)}
    </p>
  );
}

/** إضافة مشتريات: منتج (أو منتج محدد مسبقاً)، الكمية، وسعر الشراء الإلزامي. */
export function PurchaseDialog({
  products,
  initialProductId,
  onClose,
}: {
  products: Product[];
  initialProductId?: string | undefined;
  onClose: () => void;
}) {
  const { supabase } = usePanel();
  const done = useDone(onClose);
  const [productId, setProductId] = useState(initialProductId ?? '');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<{ qty?: string; price?: string; product?: string }>({});
  const product = products.find((p) => p.id === productId);

  const save = useMutation({
    mutationFn: async () => {
      if (!product) {
        setErrors({ product: 'اختر المنتج' });
        return false;
      }
      const v = validatePurchase(product.unit, qty, price);
      setErrors(v.errors);
      if (Object.keys(v.errors).length > 0) return false;
      await adjustStock(supabase, {
        productId: product.id,
        qty: v.units,
        type: 'purchase',
        unitCost: v.unitCost,
      });
      return true;
    },
    onSuccess: async (ok) => {
      if (ok) await done();
    },
  });

  const preview = product ? validatePurchase(product.unit, qty, price) : null;
  const total =
    preview && Object.keys(preview.errors).length === 0 ? preview.units * preview.unitCost : null;
  return (
    <Modal title="إضافة مشتريات" onClose={onClose} testId="purchase-dialog">
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="المنتج" htmlFor="pu-product" error={errors.product}>
          <select
            id="pu-product"
            className={inputClass}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">اختر المنتج</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {product && (
          <p className="m-0 text-sm text-text-muted">
            الرصيد الحالي:{' '}
            <span className="num">{formatAdminQuantity(product.qty, product.unit)}</span>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={`الكمية (${product ? adminUnitLabel(product.unit) : 'كيلو أو وحدة'})`}
            htmlFor="pu-qty"
            error={errors.qty}
          >
            <input
              id="pu-qty"
              className={`${inputClass} num`}
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </Field>
          <Field
            label={product ? priceLabel(product.unit, 'سعر الشراء') : 'سعر الشراء'}
            htmlFor="pu-price"
            error={errors.price}
          >
            <input
              id="pu-price"
              className={`${inputClass} num`}
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
        </div>
        {total !== null && (
          <p className="m-0 text-sm">
            المجموع: <span className="num font-semibold">{formatIQD(total)}</span> · يصير سعر الشراء
            الحالي
          </p>
        )}
        <ErrorBox error={save.error} />
        <button type="submit" disabled={save.isPending} className={submitClass}>
          {save.isPending ? 'جارٍ الحفظ…' : 'حفظ المشتريات'}
        </button>
      </form>
    </Modal>
  );
}

/** تسوية جرد: كمية بإشارة (+ زيادة، − نقص) وملاحظة إلزامية؛ السالبة تُحسب خسارة بكلفة الوحدة. */
export function AdjustDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const { supabase } = usePanel();
  const done = useDone(onClose);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ qty?: string; note?: string }>({});
  const save = useMutation({
    mutationFn: async () => {
      const v = validateAdjust(product.unit, qty, note, product.qty);
      setErrors(v.errors);
      if (Object.keys(v.errors).length > 0) return false;
      await adjustStock(supabase, {
        productId: product.id,
        qty: v.units,
        type: 'adjust',
        note: note.trim(),
      });
      return true;
    },
    onSuccess: async (ok) => {
      if (ok) await done();
    },
  });
  return (
    <Modal title={`تسوية جرد: ${product.name}`} onClose={onClose} testId="adjust-dialog">
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="m-0 text-sm text-text-muted">
          الرصيد بالنظام:{' '}
          <span className="num">{formatAdminQuantity(product.qty, product.unit)}</span>
        </p>
        <Field
          label={`الفرق (${adminUnitLabel(product.unit)})`}
          htmlFor="ad-qty"
          error={errors.qty}
          hint="موجب للزيادة، سالب للنقص (مثلاً ‎-1.5)"
        >
          <input
            id="ad-qty"
            className={`${inputClass} num`}
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        <Field label="السبب" htmlFor="ad-note" error={errors.note}>
          <input
            id="ad-note"
            className={inputClass}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <ErrorBox error={save.error} />
        <button type="submit" disabled={save.isPending} className={submitClass}>
          {save.isPending ? 'جارٍ الحفظ…' : 'حفظ التسوية'}
        </button>
      </form>
    </Modal>
  );
}

/** حد النقص لكل منتج (بالكيلو أو بالوحدة). */
export function ThresholdDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const { supabase } = usePanel();
  const done = useDone(onClose);
  const [value, setValue] = useState(() =>
    String(toAdminQty(product.low_stock_threshold, product.unit)),
  );
  const [error, setError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: async () => {
      const v = validateThreshold(product.unit, value);
      if ('error' in v) {
        setError(v.error);
        return false;
      }
      setError(undefined);
      await saveProduct(supabase, { id: product.id, low_stock_threshold: v.value });
      return true;
    },
    onSuccess: async (ok) => {
      if (ok) await done();
    },
  });
  return (
    <Modal title={`حد النقص: ${product.name}`} onClose={onClose} testId="threshold-dialog">
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label={`حد النقص (${adminUnitLabel(product.unit)})`}
          htmlFor="th-value"
          error={error}
        >
          <input
            id="th-value"
            className={`${inputClass} num`}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <ErrorBox error={save.error} />
        <button type="submit" disabled={save.isPending} className={submitClass}>
          حفظ
        </button>
      </form>
    </Modal>
  );
}
