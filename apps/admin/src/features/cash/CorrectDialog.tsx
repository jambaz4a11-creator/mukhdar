'use client';
// "تصحيح" تسليم (أدمن فقط، SPEC-cash K12، C9): المبلغ المستلم والملاحظة فقط. الملاحظة إلزامية دائماً هنا،
// ويُدقَّق بـ admin_audit ويُبلَّغ السائق (من الدالة نفسها). الطلبات المربوطة لا تتغير.
import { errorMessage, formatIQD } from '@mukhdar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { Field, Modal, inputClass } from '@/features/catalog/ui';
import { cashKeys, correctHandover, type HandoverRow } from './api';
import { NOTE_MAX, parseReceived, validateNote } from './amount';
import { DiffBadge } from './DiffBadge';
import { cashDifference } from './difference';

export function CorrectDialog({
  row,
  onClose,
  onNotice,
}: {
  row: HandoverRow;
  onClose: () => void;
  onNotice: (text: string) => void;
}) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const [amountRaw, setAmountRaw] = useState(String(row.received_iqd));
  const [noteRaw, setNoteRaw] = useState('');
  const parsed = parseReceived(amountRaw, row.expected_iqd);
  const note = validateNote(noteRaw, true);
  const unchanged = parsed.state === 'ok' && parsed.value === row.received_iqd;
  const diff = parsed.state === 'ok' ? cashDifference(row.expected_iqd, parsed.value) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (parsed.state !== 'ok' || !note.ok || note.value === null) throw new Error('INVALID_FORM');
      return correctHandover(supabase, {
        id: row.id,
        receivedIqd: parsed.value,
        note: note.value,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: cashKeys.all });
      onNotice('تم تصحيح التسليم');
      onClose();
    },
  });

  return (
    <Modal
      title={`تصحيح تسليم ${row.driver_name ?? 'سائق محذوف'}`}
      onClose={onClose}
      testId="correct-dialog"
    >
      <p className="m-0 text-sm">
        المطلوب <span className="num font-semibold">{formatIQD(row.expected_iqd)}</span> · المسجَّل{' '}
        <span className="num font-semibold">{formatIQD(row.received_iqd)}</span>. التصحيح يغيّر
        المبلغ المستلم والملاحظة فقط، ويُبلَّغ السائق.
      </p>
      <Field
        label="المبلغ الصحيح المستلم"
        htmlFor="correct-received"
        error={parsed.state === 'invalid' ? parsed.message : undefined}
      >
        <input
          id="correct-received"
          inputMode="numeric"
          autoComplete="off"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value)}
          className={`${inputClass} num ${parsed.state === 'invalid' ? 'border-danger' : ''}`}
        />
      </Field>
      {diff && <DiffBadge diff={diff} />}
      <Field
        label="ملاحظة (إلزامية)"
        htmlFor="correct-note"
        error={noteRaw !== '' && !note.ok ? note.message : undefined}
        hint={`سبب التصحيح، حتى ${NOTE_MAX} حرف`}
      >
        <textarea
          id="correct-note"
          rows={3}
          value={noteRaw}
          maxLength={NOTE_MAX + 50}
          onChange={(e) => setNoteRaw(e.target.value)}
          className="w-full rounded-control border border-border bg-surface p-3 text-[15px] text-text"
        />
      </Field>
      {save.error && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {errorMessage(save.error)}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="correct-confirm"
          disabled={parsed.state !== 'ok' || unchanged || !note.ok || save.isPending}
          onClick={() => save.mutate()}
          className="h-11 flex-1 rounded-control bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          {save.isPending ? 'جارٍ الحفظ…' : 'حفظ التصحيح'}
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
