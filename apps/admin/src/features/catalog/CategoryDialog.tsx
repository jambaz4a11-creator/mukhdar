'use client';
// إضافة/تعديل قسم (SPEC-admin §2.2): الاسم، صورة (WebP 400px، < 100KB) تحت categories/<id>/، والإخفاء.
// كتابة مباشرة على categories (RLS: أدمن فقط).
import { errorMessage } from '@mukhdar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { catalogKeys, createCategory, updateCategory, type Category } from './api';
import {
  CATEGORY_IMAGE,
  categoryImagePath,
  publicImageUrl,
  removeImage,
  uploadImage,
} from './image';
import { Field, ImagePicker, Modal, inputClass } from './ui';

export function CategoryDialog({
  category,
  nextSortOrder,
  onClose,
}: {
  category: Category | null;
  nextSortOrder: number;
  onClose: () => void;
}) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [active, setActive] = useState(category?.is_active ?? true);
  const [image, setImage] = useState<Blob | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 40) {
        setNameError(trimmed ? 'الاسم أطول من 40 حرف' : 'اكتب اسم القسم');
        return false;
      }
      setNameError(undefined);
      let id = category?.id;
      if (id === undefined) id = (await createCategory(supabase, trimmed, nextSortOrder)).id;
      const patch: Partial<Category> = category ? { name: trimmed, is_active: active } : {};
      if (image) {
        const path = categoryImagePath(id);
        await uploadImage(supabase, path, image);
        patch.image_path = path;
      }
      if (Object.keys(patch).length > 0) await updateCategory(supabase, id, patch);
      if (image && category?.image_path) await removeImage(supabase, category.image_path);
      return true;
    },
    onSuccess: async (ok) => {
      if (!ok) return;
      await qc.invalidateQueries({ queryKey: catalogKeys.all });
      onClose();
    },
  });

  return (
    <Modal
      title={category ? `تعديل قسم ${category.name}` : 'قسم جديد'}
      onClose={onClose}
      testId="category-dialog"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="اسم القسم" htmlFor="c-name" error={nameError}>
          <input
            id="c-name"
            className={inputClass}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <ImagePicker
          id="c-image"
          label="صورة القسم"
          limits={CATEGORY_IMAGE}
          currentUrl={publicImageUrl(supabase, category?.image_path ?? null)}
          onPicked={setImage}
        />
        {category && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
            ظاهر للزبون (إخفاؤه لا يحذف منتجاته)
          </label>
        )}
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
          {save.isPending ? 'جارٍ الحفظ…' : 'حفظ القسم'}
        </button>
      </form>
    </Modal>
  );
}
