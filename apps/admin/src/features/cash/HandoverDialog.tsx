'use client';
// نافذة "استلام الكاش من <الاسم>" (SPEC-cash §4، C2–C4): المطلوب من قاعدة البيانات (K4)، المبلغ المستلم حقل فارغ
// (لا يُملأ تلقائياً حتى يُعَدّ فعلاً) مع زر "نفس المبلغ"، فرق حي للعرض فقط (القاعدة تعيد حسابه)، ملاحظة إلزامية مع
// أي فرق. المطلوب والعدد المعروضان هما ما يُرسل كـ expected: أي تغيير بقاعدة البيانات بعد العرض
// (توصيل جديد، تغيّر إعداد الأجرة) يرفضه الخادم بـ CASH_BALANCE_CHANGED، فتتحدّث النافذة وتُمسح الكتابة.
import { errorMessage, formatIQD } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { Field, Modal, inputClass } from '@/features/catalog/ui';
import { formatTime } from '@/features/orders/format';
import { cashKeys, fetchOutstandingOrders, recordHandover, type OutstandingRow } from './api';
import { NOTE_MAX, noteRequired, parseReceived, validateNote } from './amount';
import { DiffBadge } from './DiffBadge';
import { cashDifference } from './difference';
import { handoverFailure } from './errors';
import { keyFor, newKeyState, rotateKey, type KeyState } from './idempotency';
import { basisLabel } from './text';

const newId = () => crypto.randomUUID();

interface Shown {
  expected: number;
  count: number;
  includesFee: boolean;
}

export function HandoverDialog({
  row,
  live,
  onClose,
  onNotice,
}: {
  row: OutstandingRow;
  /** أحدث صف للسائق من استعلام الأرصدة (يتحدث بالتركيز وكل 30 ثانية)؛ undefined = لم يعد له رصيد */
  live: OutstandingRow | undefined;
  onClose: () => void;
  onNotice: (text: string) => void;
}) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const name = row.full_name ?? 'سائق';
  const [shown, setShown] = useState<Shown>({
    expected: row.outstanding_iqd,
    count: row.order_count,
    includesFee: row.includes_delivery_fee,
  });
  const [amountRaw, setAmountRaw] = useState('');
  const [noteRaw, setNoteRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const keyRef = useRef<KeyState>(newKeyState(newId));
  /** بعد النجاح يُحدَّث الرصيد إلى 0 فلا تُعامَل اختفاء الصف كـ "انسجل قبل شوية" */
  const doneRef = useRef(false);

  const orders = useQuery({
    queryKey: cashKeys.orders(row.driver_id),
    queryFn: () => fetchOutstandingOrders(supabase, row.driver_id),
  });

  // الرصيد تغيّر بعد فتح النافذة (استطلاع أو تركيز): نفس سلوك CASH_BALANCE_CHANGED، فلا يُقارن عدٌّ قديم بمطلوب جديد
  useEffect(() => {
    if (doneRef.current) return;
    if (!live) {
      onNotice('انسجل الاستلام قبل شوية');
      onClose();
      return;
    }
    if (live.outstanding_iqd !== shown.expected || live.order_count !== shown.count) {
      setShown({
        expected: live.outstanding_iqd,
        count: live.order_count,
        includesFee: live.includes_delivery_fee,
      });
      setAmountRaw('');
      setError(null);
      setWarning(
        `تغيّر المبلغ (وصل توصيل جديد). المطلوب الآن ${formatIQD(live.outstanding_iqd)}. عدّ من جديد`,
      );
      keyRef.current = rotateKey(keyRef.current, newId);
    } else if (live.includes_delivery_fee !== shown.includesFee) {
      setShown((s) => ({ ...s, includesFee: live.includes_delivery_fee }));
    }
  }, [live]);

  const parsed = parseReceived(amountRaw, shown.expected);
  const diff = parsed.state === 'ok' ? cashDifference(shown.expected, parsed.value) : null;
  const needNote = diff ? noteRequired(diff) : false;
  const note = validateNote(noteRaw, needNote);
  const canSubmit = parsed.state === 'ok' && note.ok;

  const submit = useMutation({
    mutationFn: async () => {
      if (parsed.state !== 'ok' || !note.ok) throw new Error('INVALID_FORM');
      const { key, state } = keyFor(keyRef.current, parsed.value, newId);
      keyRef.current = state;
      return recordHandover(supabase, {
        driverId: row.driver_id,
        expectedIqd: shown.expected,
        orderCount: shown.count,
        receivedIqd: parsed.value,
        note: note.value,
        key,
      });
    },
    onSuccess: async (r) => {
      doneRef.current = true;
      await qc.invalidateQueries({ queryKey: cashKeys.all });
      onNotice(`تم: استلمت ${formatIQD(r.received_iqd)} من ${name}`);
      onClose();
    },
    onError: async (e) => {
      const f = handoverFailure(e);
      if (f.balance) {
        setShown((s) => ({
          ...s,
          expected: f.balance?.expected_iqd ?? s.expected,
          count: f.balance?.order_count ?? s.count,
        }));
      }
      if (f.clearAmount) setAmountRaw('');
      if (f.rotateKey) keyRef.current = rotateKey(keyRef.current, newId);
      setWarning(null);
      if (f.refresh) await qc.invalidateQueries({ queryKey: cashKeys.all });
      if (f.close) {
        onNotice(f.message);
        onClose();
        return;
      }
      setError(f.message);
    },
  });

  return (
    <Modal title={`استلام الكاش من ${name}`} onClose={onClose} testId="handover-dialog">
      <div className="flex flex-col gap-0.5 rounded-control bg-primary-soft px-3.5 py-3">
        <span className="text-sm text-text-muted">المطلوب</span>
        <span className="text-2xl font-bold text-primary" data-testid="handover-expected">
          <span className="num">{formatIQD(shown.expected)}</span>
        </span>
        <span className="text-sm">
          عن <span className="num">{shown.count}</span> طلب ·{' '}
          <span data-testid="handover-basis">{basisLabel(shown.includesFee)}</span>
        </span>
      </div>

      <details className="rounded-control border border-border px-3 py-2">
        <summary className="cursor-pointer text-sm text-primary">الطلبات المشمولة</summary>
        <div className="mt-2 flex max-h-48 flex-col overflow-y-auto" data-testid="handover-orders">
          {orders.isPending && <span className="text-sm text-text-muted">جارٍ التحميل…</span>}
          {orders.error && (
            <span role="alert" className="text-sm text-danger">
              {errorMessage(orders.error)}
            </span>
          )}
          {(orders.data ?? []).map((o) => (
            <div
              key={o.order_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-divider py-1.5 text-[13px] first:border-t-0"
            >
              <span className="num font-semibold">#{o.order_number}</span>
              <span className="flex-1">
                {[
                  o.subsection ? `بلوك ${o.subsection}` : null,
                  o.building ? `بناية ${o.building}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="num text-text-muted">{formatTime(o.delivered_at)}</span>
              <span className="num font-semibold">{formatIQD(o.amount_iqd)}</span>
            </div>
          ))}
          {orders.isSuccess && orders.data.length < shown.count && (
            <span className="pt-1 text-xs text-text-muted">
              تُعرض أحدث {orders.data.length} طلب فقط من <span className="num">{shown.count}</span>
            </span>
          )}
        </div>
      </details>

      <Field
        label="المبلغ اللي استلمته"
        htmlFor="handover-received"
        error={parsed.state === 'invalid' ? parsed.message : undefined}
        hint="اعدّ الفلوس واكتب المبلغ بيدك"
      >
        <div className="flex gap-2">
          <input
            id="handover-received"
            inputMode="numeric"
            autoComplete="off"
            value={amountRaw}
            aria-invalid={parsed.state === 'invalid' ? 'true' : undefined}
            onChange={(e) => {
              setAmountRaw(e.target.value);
              setError(null);
              setWarning(null);
            }}
            className={`${inputClass} num min-w-0 flex-1 ${parsed.state === 'invalid' ? 'border-danger' : ''}`}
          />
          <button
            type="button"
            data-testid="handover-same"
            onClick={() => {
              setAmountRaw(String(shown.expected));
              setError(null);
              setWarning(null);
            }}
            className="h-11 shrink-0 rounded-control border border-border bg-surface px-3 text-sm"
          >
            نفس المبلغ
          </button>
        </div>
      </Field>

      {diff && (
        <div className="flex items-center gap-2" role="status" data-testid="handover-diff">
          <DiffBadge diff={diff} />
        </div>
      )}

      {needNote && (
        <Field
          label="ملاحظة (إلزامية مع الفرق)"
          htmlFor="handover-note"
          error={noteRaw !== '' && !note.ok ? note.message : undefined}
          hint={`اشرح سبب الفرق، حتى ${NOTE_MAX} حرف`}
        >
          <textarea
            id="handover-note"
            rows={3}
            value={noteRaw}
            maxLength={NOTE_MAX + 50}
            onChange={(e) => setNoteRaw(e.target.value)}
            className="w-full rounded-control border border-border bg-surface p-3 text-[15px] text-text"
          />
        </Field>
      )}

      {warning && (
        <p
          role="status"
          data-testid="handover-changed"
          className="m-0 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text"
        >
          {warning}
        </p>
      )}
      {error && (
        <p
          role="alert"
          data-testid="handover-error"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="handover-confirm"
          disabled={!canSubmit || submit.isPending}
          onClick={() => submit.mutate()}
          className="h-11 flex-1 rounded-control bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          {submit.isPending ? 'جارٍ الحفظ…' : 'تأكيد الاستلام'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-control border border-border px-4 text-sm"
        >
          إلغاء
        </button>
      </div>
    </Modal>
  );
}
