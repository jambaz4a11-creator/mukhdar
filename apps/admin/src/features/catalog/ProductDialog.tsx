'use client';
// إنشاء/تعديل منتج (SPEC-admin §2.2): وحدة البيع من القائمة الثابتة، السعر وسعر الشراء وحد النقص بالكيلو
// لمنتجات نص الكيلو، وصورة مصغّرة بالمتصفح. الحفظ عبر admin_save_product ثم رفع الصورة وحفظ مسارها.
import { SALE_UNITS, adminUnitLabel, errorMessage } from '@mukhdar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { catalogKeys, saveProduct, type Category, type Product } from './api';
import {
  emptyProductForm,
  priceLabel,
  toProductForm,
  validateProductForm,
  type ProductField,
  type ProductFormValues,
  type ProductSource,
} from './forms';
import { PRODUCT_IMAGE, productImagePath, publicImageUrl, removeImage, uploadImage } from './image';
import { Field, ImagePicker, Modal, inputClass } from './ui';

function source(p: Product): ProductSource {
  return {
    name: p.name,
    category_id: p.category_id,
    unit: p.unit,
    price_iqd: p.price_iqd,
    description: p.description,
    is_active: p.is_active,
    cost_iqd: p.cost_iqd,
    low_stock_threshold: p.low_stock_threshold,
  };
}

export function ProductDialog({
  product,
  categories,
  defaultCategoryId,
  onClose,
}: {
  product: Product | null;
  categories: Category[];
  defaultCategoryId?: number | undefined;
  onClose: () => void;
}) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const original = product ? source(product) : undefined;
  const [values, setValues] = useState<ProductFormValues>(() =>
    original ? toProductForm(original) : emptyProductForm(defaultCategoryId ?? categories[0]?.id),
  );
  const [errors, setErrors] = useState<Partial<Record<ProductField, string>>>({});
  const [image, setImage] = useState<Blob | null>(null);
  const set = (patch: Partial<ProductFormValues>) => setValues((v) => ({ ...v, ...patch }));

  const save = useMutation({
    mutationFn: async () => {
      const { errors: errs, payload } = validateProductForm(values, original);
      setErrors(errs);
      if (!payload) return false;
      const id = await saveProduct(supabase, product ? { id: product.id, ...payload } : payload);
      if (image) {
        const path = productImagePath(id);
        await uploadImage(supabase, path, image);
        await saveProduct(supabase, { id, image_path: path });
        if (product?.image_path) await removeImage(supabase, product.image_path);
      }
      return true;
    },
    onSuccess: async (ok) => {
      if (!ok) return;
      await qc.invalidateQueries({ queryKey: catalogKeys.all });
      onClose();
    },
  });

  const unitLabel = adminUnitLabel(values.unit);
  return (
    <Modal
      title={product ? `تعديل ${product.name}` : 'منتج جديد'}
      onClose={onClose}
      testId="product-dialog"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        noValidate
      >
        <Field label="اسم المنتج" htmlFor="p-name" error={errors.name}>
          <input
            id="p-name"
            className={inputClass}
            value={values.name}
            maxLength={80}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="القسم" htmlFor="p-category" error={errors.categoryId}>
            <select
              id="p-category"
              className={inputClass}
              value={values.categoryId}
              onChange={(e) => set({ categoryId: e.target.value })}
            >
              <option value="">اختر القسم</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.is_active ? '' : ' (مخفي)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="وحدة البيع للزبون" htmlFor="p-unit" error={errors.unit}>
            <select
              id="p-unit"
              className={inputClass}
              value={values.unit}
              onChange={(e) => set({ unit: e.target.value })}
            >
              {SALE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={priceLabel(values.unit)}
            htmlFor="p-price"
            error={errors.price}
            hint={unitLabel === 'كيلو' ? 'مضاعفات 500؛ الزبون يرى سعر النص كيلو' : 'مضاعفات 250'}
          >
            <input
              id="p-price"
              className={`${inputClass} num`}
              inputMode="numeric"
              value={values.price}
              onChange={(e) => set({ price: e.target.value })}
            />
          </Field>
          <Field
            label={priceLabel(values.unit, 'سعر الشراء')}
            htmlFor="p-cost"
            error={errors.cost}
            hint="اختياري: يتحدّث تلقائياً من المشتريات"
          >
            <input
              id="p-cost"
              className={`${inputClass} num`}
              inputMode="numeric"
              value={values.cost}
              onChange={(e) => set({ cost: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label={`حد النقص (${unitLabel})`}
          htmlFor="p-threshold"
          error={errors.threshold}
          hint="تنبيه للأدمن عند نزول الرصيد تحته"
        >
          <input
            id="p-threshold"
            className={`${inputClass} num`}
            inputMode="decimal"
            value={values.threshold}
            onChange={(e) => set({ threshold: e.target.value })}
          />
        </Field>
        <Field label="الوصف (اختياري)" htmlFor="p-description">
          <textarea
            id="p-description"
            className="min-h-16 w-full rounded-control border border-border bg-surface p-3 text-[15px]"
            maxLength={500}
            value={values.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
        <ImagePicker
          id="p-image"
          label="صورة المنتج"
          limits={PRODUCT_IMAGE}
          currentUrl={publicImageUrl(supabase, product?.image_path ?? null)}
          onPicked={setImage}
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.isActive}
            onChange={(e) => set({ isActive: e.target.checked })}
            className="h-5 w-5 accent-primary"
          />
          نشط (يظهر للزبون)
        </label>
        {save.error && (
          <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
            {errorMessage(save.error)}
          </p>
        )}
        <button
          type="submit"
          disabled={save.isPending}
          className="h-12 rounded-control bg-primary text-[15px] font-bold text-white disabled:opacity-60"
        >
          {save.isPending ? 'جارٍ الحفظ…' : 'حفظ المنتج'}
        </button>
      </form>
    </Modal>
  );
}
