'use client';
// إضافة/تعديل قسم (SPEC-admin §2.2): الاسم، صورة (WebP 400px، < 100KB) تحت categories/<id>/، والإخفاء.
// الكتابة عبر دوال قاعدة البيانات (أدمن فقط، مع تدقيق). الحذف فقط لقسم بلا منتجات، وإلا الإخفاء.
import { errorMessage } from '@mukhdar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { catalogKeys, createCategory, deleteCategory, updateCategory, type Category } from './api';
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
  productCount,
  onClose,
}: {
  category: Category | null;
  productCount: number;
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
      if (id === undefined) id = (await createCategory(supabase, trimmed)).id;
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

  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: async () => {
      if (!category) return;
      const path = await deleteCategory(supabase, category.id);
      if (path) await removeImage(supabase, path).catch(() => undefined);
    },
    onSuccess: async () => {
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
        {category && (
          <div className="flex flex-col gap-2 rounded-control border border-border p-3 text-sm">
            {productCount > 0 ? (
              <p className="m-0 text-text-muted" data-testid="category-delete-blocked">
                لا يمكن حذف قسم فيه {productCount} منتج. أخفِه من الخيار أعلاه بدل الحذف.
              </p>
            ) : confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="flex-1">حذف القسم نهائياً؟</span>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                  className="h-10 rounded-control bg-danger px-4 font-bold text-white disabled:opacity-60"
                >
                  تأكيد الحذف
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="h-10 rounded-control border border-border px-4"
                >
                  تراجع
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="h-10 self-start rounded-control border border-danger px-4 font-semibold text-danger"
              >
                حذف القسم
              </button>
            )}
          </div>
        )}
        {(save.error || remove.error) && (
          <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
            {errorMessage(save.error ?? remove.error)}
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
