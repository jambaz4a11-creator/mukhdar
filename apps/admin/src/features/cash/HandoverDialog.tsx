'use client';
// نافذة "استلام الكاش من <الاسم>" (SPEC-cash §4، C2–C4): المطلوب من قاعدة البيانات (K4)، المبلغ المستلم حقل فارغ
// (لا يُملأ تلقائياً حتى يُعَدّ فعلاً) مع زر "نفس المبلغ"، فرق حي للعرض فقط (القاعدة تعيد حسابه)، ملاحظة إلزامية مع
// أي فرق. المطلوب والعدد المعروضان هما ما يُرسل كـ expected: أي تغيير بقاعدة البيانات بعد العرض
// (توصيل جديد، تغيّر إعداد الأجرة) يرفضه الخادم بـ CASH_BALANCE_CHANGED، فتتحدّث النافذة وتُمسح الكتابة.
// R4 M2: "انسجل قبل شوية" (من الخادم أو لأن الرصيد صار 0 بالاستطلاع) لا يُغلق النافذة بصمت: تعرض المبلغ والملاحظة
// المسجّلين فعلاً، وتنبّه إن اختلفا عمّا على الشاشة (مثلاً بعد رد ضاع ثم تعديل المبلغ). R4 L7: الاستطلاع لا يمس
// النافذة أثناء الإرسال. R4 L8: تغيّر المبلغ بنفس العدد = تغيّر إعداد الأجرة.
import { errorMessage, formatIQD } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { Field, Modal, inputClass } from '@/features/catalog/ui';
import { formatTime } from '@/features/orders/format';
import {
  cashKeys,
  fetchLatestHandover,
  fetchOutstandingOrders,
  recordHandover,
  type HandoverRow,
  type OutstandingRow,
} from './api';
import { NOTE_MAX, noteRequired, parseReceived, validateNote } from './amount';
import { DiffBadge } from './DiffBadge';
import { cashDifference } from './difference';
import {
  ALREADY_RECORDED,
  balanceChangedMessage,
  handoverFailure,
  recordedMismatchWarning,
} from './errors';
import { keyFor, newKeyState, rotateKey, type KeyState } from './idempotency';
import { basisLabel } from './text';

const newId = () => crypto.randomUUID();

interface Shown {
  expected: number;
  count: number;
  includesFee: boolean;
}

interface Typed {
  amount: number;
  note: string | null;
}

/** وضع "انسجل قبل شوية": آخر تسليم للسائق كما بقاعدة البيانات */
type Recorded =
  | { state: 'loading' }
  | { state: 'ok'; row: HandoverRow; warning: string | null }
  | { state: 'unknown' };

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
  /** بعد النجاح (أو بعد دخول وضع "انسجل قبل شوية") لا يُعامَل اختفاء الصف من جديد */
  const doneRef = useRef(false);
  /** R4 L7: طلب تسجيل قيد الإرسال؛ الاستطلاع لا يغيّر النافذة حتى يرجع الرد */
  const pendingRef = useRef(false);
  /** آخر ما أُرسل (المبلغ والملاحظة)، للمقارنة بما انسجل */
  const sentRef = useRef<Typed | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);

  const orders = useQuery({
    queryKey: cashKeys.orders(row.driver_id),
    queryFn: () => fetchOutstandingOrders(supabase, row.driver_id),
  });

  const parsed = parseReceived(amountRaw, shown.expected);
  const diff = parsed.state === 'ok' ? cashDifference(shown.expected, parsed.value) : null;
  const needNote = diff ? noteRequired(diff) : false;
  const note = validateNote(noteRaw, needNote);
  const canSubmit = parsed.state === 'ok' && note.ok;
  /** ما على الشاشة الآن إن كان صالحاً، وإلا آخر ما أُرسل */
  const typedNow: Typed | null =
    parsed.state === 'ok'
      ? { amount: parsed.value, note: note.ok ? note.value : null }
      : sentRef.current;

  /** R4 M2: الاستلام انسجل قبل؛ اعرض ما انسجل فعلاً وقارنه بما على الشاشة */
  async function showRecorded(typed: Typed | null) {
    if (doneRef.current) return;
    doneRef.current = true;
    setError(null);
    setWarning(null);
    setRecorded({ state: 'loading' });
    void qc.invalidateQueries({ queryKey: cashKeys.all });
    try {
      const latest = await qc.fetchQuery({
        queryKey: cashKeys.latest(row.driver_id),
        queryFn: () => fetchLatestHandover(supabase, row.driver_id),
        staleTime: 0,
      });
      setRecorded(
        latest
          ? {
              state: 'ok',
              row: latest,
              warning: typed ? recordedMismatchWarning(latest, typed) : null,
            }
          : { state: 'unknown' },
      );
    } catch {
      setRecorded({ state: 'unknown' });
    }
  }

  // الرصيد تغيّر بعد فتح النافذة (استطلاع أو تركيز): نفس سلوك CASH_BALANCE_CHANGED، فلا يُقارن عدٌّ قديم بمطلوب جديد
  useEffect(() => {
    if (doneRef.current || pendingRef.current) return;
    if (!live) {
      void showRecorded(typedNow);
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
        balanceChangedMessage(
          { expected_iqd: live.outstanding_iqd, order_count: live.order_count },
          shown.count,
        ),
      );
      keyRef.current = rotateKey(keyRef.current, newId);
    } else if (live.includes_delivery_fee !== shown.includesFee) {
      setShown((s) => ({ ...s, includesFee: live.includes_delivery_fee }));
    }
  }, [live]);

  const submit = useMutation({
    mutationFn: async () => {
      if (parsed.state !== 'ok' || !note.ok) throw new Error('INVALID_FORM');
      const { key, state } = keyFor(keyRef.current, parsed.value, newId, note.value);
      keyRef.current = state;
      sentRef.current = { amount: parsed.value, note: note.value };
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
    onSettled: () => {
      pendingRef.current = false;
    },
    onError: async (e) => {
      const f = handoverFailure(e, shown.count);
      if (f.lookup) {
        await showRecorded(sentRef.current);
        return;
      }
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

  if (recorded) {
    return (
      <Modal title={`استلام الكاش من ${name}`} onClose={onClose} testId="handover-dialog">
        <div
          role="status"
          data-testid="handover-recorded"
          className="flex flex-col gap-1.5 rounded-control bg-primary-soft px-3.5 py-3"
        >
          <span className="text-[15px] font-bold text-primary">{ALREADY_RECORDED}</span>
          {recorded.state === 'loading' && (
            <span className="text-sm text-text-muted">جارٍ جلب المبلغ المسجّل…</span>
          )}
          {recorded.state === 'unknown' && (
            <span className="text-sm">ما قدرنا نجيب المبلغ المسجّل. شوفه بتبويب السجل.</span>
          )}
          {recorded.state === 'ok' && (
            <>
              <span className="text-sm">
                المبلغ المسجّل:{' '}
                <span className="num text-lg font-bold" data-testid="handover-recorded-amount">
                  {formatIQD(recorded.row.received_iqd)}
                </span>{' '}
                من <span className="num">{formatIQD(recorded.row.expected_iqd)}</span>
              </span>
              {recorded.row.difference_iqd !== 0 && (
                <DiffBadge
                  diff={cashDifference(recorded.row.expected_iqd, recorded.row.received_iqd)}
                />
              )}
              <span className="text-sm" data-testid="handover-recorded-note">
                {recorded.row.note ? `الملاحظة: ${recorded.row.note}` : 'بلا ملاحظة'}
              </span>
              <span className="text-xs text-text-muted">
                سجّله {recorded.row.recorded_by_name ?? 'حساب محذوف'} ·{' '}
                <span className="num">{formatTime(recorded.row.recorded_at)}</span>
              </span>
            </>
          )}
        </div>
        {recorded.state === 'ok' && recorded.warning && (
          <p
            role="alert"
            data-testid="handover-recorded-warning"
            className="m-0 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text"
          >
            {recorded.warning}
          </p>
        )}
        <button
          type="button"
          data-testid="handover-recorded-ok"
          onClick={onClose}
          className="h-11 rounded-control bg-primary px-4 text-sm font-bold text-white"
        >
          تمام
        </button>
      </Modal>
    );
  }

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
          onClick={() => {
            pendingRef.current = true;
            submit.mutate();
          }}
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
