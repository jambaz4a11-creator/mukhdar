// مفتاح منع التكرار لنافذة التسليم (SPEC-cash §4): يُولَّد عند فتح النافذة ويُعاد مع كل إعادة محاولة لنفس المبلغ
// (فضغطتان أو إعادة بعد انقطاع = تسليم واحد). مبلغ مختلف ← مفتاح جديد (لا نعيد نتيجة قديمة لمبلغ آخر)،
// وبعد CASH_BALANCE_CHANGED ← مفتاح جديد دائماً. دوال صرفة؛ المولّد يُمرَّر (crypto.randomUUID بالمتصفح).

export interface KeyState {
  key: string;
  /** المبلغ الذي ارتبط به المفتاح، أو null قبل أول محاولة */
  amount: number | null;
}

export type KeyGenerator = () => string;

export function newKeyState(generate: KeyGenerator): KeyState {
  return { key: generate(), amount: null };
}

export function keyFor(
  state: KeyState,
  amount: number,
  generate: KeyGenerator,
): { key: string; state: KeyState } {
  if (state.amount === null || state.amount === amount) {
    const next = { key: state.key, amount };
    return { key: next.key, state: next };
  }
  const next = { key: generate(), amount };
  return { key: next.key, state: next };
}

export function rotateKey(_state: KeyState, generate: KeyGenerator): KeyState {
  return { key: generate(), amount: null };
}
