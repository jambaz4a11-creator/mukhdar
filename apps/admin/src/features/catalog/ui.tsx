'use client';
// مكوّنات صغيرة مشتركة لصفحات المنتجات والمخزون والهدر: نافذة، حقل بتسمية وخطأ، اختيار صورة مع
// تصغير بالمتصفح، وأزرار الترتيب (مع السحب).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { imageErrorMessage, resizeImage, type ImageLimits } from './image';

export function Modal({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        data-testid={testId}
        className="flex max-h-[92vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-card bg-surface p-5 shadow-lg"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={id} className="m-0 text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="h-10 w-10 rounded-control border border-border text-lg"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <span role="alert" className="text-xs text-danger" data-testid={`error-${htmlFor}`}>
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-text-muted">{hint}</span>
      ) : null}
    </div>
  );
}

export const inputClass =
  'h-11 w-full rounded-control border border-border bg-surface px-3 text-[15px] text-text';

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`;
}

/** اختيار صورة ← تصغير WebP بالمتصفح فوراً (معاينة + الحجم الناتج)، والرفع عند الحفظ. */
export function ImagePicker({
  id,
  label,
  limits,
  currentUrl,
  onPicked,
}: {
  id: string;
  label: string;
  limits: ImageLimits;
  currentUrl: string | null;
  onPicked: (blob: Blob | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const pick = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    setBusy(true);
    try {
      const blob = await resizeImage(file, limits);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setPreview(urlRef.current);
      setSize(blob.size);
      onPicked(blob);
    } catch (e) {
      setError(imageErrorMessage(e));
      onPicked(null);
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ?? currentUrl;
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-control bg-background text-xs text-text-muted">
        {shown ? (
          // صورة من Storage أو معاينة محلية (blob:)؛ next/image لا يفيد هنا
          <img src={shown} alt="" className="h-full w-full object-cover" />
        ) : (
          'بلا صورة'
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-[13px] font-semibold">
          {label}
        </label>
        <input
          id={id}
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => void pick(e.target.files?.[0])}
          className="text-sm"
        />
        {busy && <span className="text-xs text-text-muted">جارٍ تصغير الصورة…</span>}
        {size !== null && !busy && (
          <span className="text-xs text-text-muted" data-testid={`${id}-size`} data-bytes={size}>
            بعد التصغير: {formatBytes(size)} (WebP، حتى {limits.maxSide}px)
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/** نقل عنصر من موضع لآخر (للترتيب بالسحب أو بالأسهم). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  if (item !== undefined) out.splice(to, 0, item);
  return out;
}

/** خصائص السحب والإفلات لعنصر بقائمة مرتبة (HTML5 DnD)، والأسهم بديل لوحة المفاتيح. */
export function useDragOrder<T>(items: readonly T[], onReorder: (next: T[]) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  return (index: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragging(index);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (e: React.DragEvent) => {
      if (dragging !== null) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragging !== null && dragging !== index) onReorder(moveItem(items, dragging, index));
      setDragging(null);
    },
    onDragEnd: () => setDragging(null),
    'data-dragging': dragging === index ? 'true' : undefined,
  });
}

export function MoveButtons({
  label,
  index,
  count,
  onMove,
  disabled,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        aria-label={`تقديم ${label}`}
        disabled={disabled || index === 0}
        onClick={() => onMove(index - 1)}
        className="h-8 w-8 rounded-md border border-border text-sm disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`تأخير ${label}`}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index + 1)}
        className="h-8 w-8 rounded-md border border-border text-sm disabled:opacity-30"
      >
        ↓
      </button>
    </span>
  );
}
