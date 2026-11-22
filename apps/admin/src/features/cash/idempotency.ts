// مفتاح منع التكرار لنافذة التسليم (SPEC-cash §4): يُولَّد عند فتح النافذة ويُعاد مع كل إعادة محاولة لنفس الطلب
// (نفس المبلغ ونفس الملاحظة)، فضغطتان أو إعادة بعد انقطاع = تسليم واحد. مبلغ أو ملاحظة مختلفة ← مفتاح جديد:
// الخادم يرفض نفس المفتاح بطلب مختلف (R4 L2، INVALID_REQUEST idempotency_key)، والمفتاح الجديد بعد تسليم انحفظ
// يرجع NO_CASH_OUTSTANDING فتعرض النافذة المبلغ المسجّل (R4 M2). بعد CASH_BALANCE_CHANGED ← مفتاح جديد دائماً.
// دوال صرفة؛ المولّد يُمرَّر (crypto.randomUUID بالمتصفح).

export interface KeyState {
  key: string;
  /** الطلب الذي ارتبط به المفتاح، أو null قبل أول محاولة */
  amount: number | null;
  note: string | null;
}

export type KeyGenerator = () => string;

export function newKeyState(generate: KeyGenerator): KeyState {
  return { key: generate(), amount: null, note: null };
}

/** الملاحظة كما يقارنها الخادم تقريباً (قص الفراغ، الفارغ = null). */
function normNote(note: string | null): string | null {
  const t = note?.trim() ?? '';
  return t === '' ? null : t;
}

export function keyFor(
  state: KeyState,
  amount: number,
  generate: KeyGenerator,
  note: string | null = null,
): { key: string; state: KeyState } {
  const n = normNote(note);
  const fresh = state.amount === null;
  const same = state.amount === amount && state.note === n;
  const next = { key: fresh || same ? state.key : generate(), amount, note: n };
  return { key: next.key, state: next };
}

export function rotateKey(_state: KeyState, generate: KeyGenerator): KeyState {
  return { key: generate(), amount: null, note: null };
}
