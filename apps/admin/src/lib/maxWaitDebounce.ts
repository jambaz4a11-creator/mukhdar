// Debounce بسقف انتظار (M4 مراجعة C): trailing بعد `wait` من آخر حدث، لكن لا يتجاوز `maxWait` منذ أول حدث
// لم يُعالَج. تحت سيل مستمر من الأحداث (أقرب من `wait`) كان الـ debounce العادي لا ينفّذ أبداً.
export interface MaxWaitDebounced {
  (): void;
  cancel(): void;
}

export function maxWaitDebounce(
  fn: () => void,
  wait: number,
  maxWait: number,
  now: () => number = Date.now,
): MaxWaitDebounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstAt: number | undefined;

  const fire = () => {
    timer = undefined;
    firstAt = undefined;
    fn();
  };
  const call = (() => {
    const t = now();
    firstAt ??= t;
    clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, Math.min(wait, maxWait - (t - firstAt))));
  }) as MaxWaitDebounced;
  call.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    firstAt = undefined;
  };
  return call;
}
