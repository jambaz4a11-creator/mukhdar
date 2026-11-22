// تحقق المبلغ المستلم والملاحظة بنافذة التسليم (SPEC-cash §3.2 خطوة 2 و§12.1). قاعدة البيانات هي المرجع
// (CASH_AMOUNT_INVALID، NOTE_REQUIRED)؛ هذا لتعطيل الزر وإظهار السبب قبل الإرسال.
import { normalizePin } from '@mukhdar/shared';
import type { CashDiff } from './difference';

export const RECEIVED_STEP = 250;
/** حد عقلاني فوق المطلوب ضد خطأ كتابة صفر زائد (نفس قاعدة البيانات). */
export const RECEIVED_MAX_EXCESS = 10_000_000;
export const NOTE_MAX = 300;

export type AmountParse =
  { state: 'empty' } | { state: 'invalid'; message: string } | { state: 'ok'; value: number };

const STEP_MESSAGE = `المبلغ لازم يكون من مضاعفات ${RECEIVED_STEP}`;

/**
 * الأرقام العربية أو اللاتينية، وفواصل الآلاف (, ٬ ،) والمسافات تُتجاهل. فارغ ← 'empty' (الحقل لا يُملأ تلقائياً).
 * غير الأرقام (سالب، كسر، حروف، أُس) ← غير صالح.
 */
export function parseReceived(raw: string, expected: number): AmountParse {
  const s = normalizePin(raw).replace(/[,٬،]/g, '');
  if (s === '') return { state: 'empty' };
  if (!/^\d+$/.test(s)) return { state: 'invalid', message: 'اكتب المبلغ بالأرقام فقط، بلا كسور' };
  if (s.length > 12) return { state: 'invalid', message: 'المبلغ كبير جداً' };
  const value = Number(s);
  if (value % RECEIVED_STEP !== 0) return { state: 'invalid', message: STEP_MESSAGE };
  if (value > expected + RECEIVED_MAX_EXCESS) {
    return { state: 'invalid', message: 'المبلغ أكبر بكثير من المطلوب، راجع الأصفار' };
  }
  return { state: 'ok', value };
}

/** الملاحظة إلزامية مع أي فرق (نقص أو زيادة). */
export function noteRequired(diff: CashDiff): boolean {
  return diff.kind !== 'match';
}

export type NoteCheck = { ok: true; value: string | null } | { ok: false; message: string };

export function validateNote(raw: string, required: boolean): NoteCheck {
  const note = raw.trim();
  if (note === '') {
    return required ? { ok: false, message: 'اكتب ملاحظة تشرح الفرق' } : { ok: true, value: null };
  }
  if (note.length > NOTE_MAX) return { ok: false, message: `الملاحظة أطول من ${NOTE_MAX} حرف` };
  return { ok: true, value: note };
}
