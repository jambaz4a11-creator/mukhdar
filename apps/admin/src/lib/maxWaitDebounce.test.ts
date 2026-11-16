import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maxWaitDebounce } from './maxWaitDebounce';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('maxWaitDebounce(250ms, max 2000ms)', () => {
  it('a single event fires once after the quiet period', () => {
    const fn = vi.fn();
    const d = maxWaitDebounce(fn, 250, 2000);
    d();
    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a burst closer than the wait still refreshes at least every maxWait: 20 events 100ms apart', () => {
    const fn = vi.fn();
    const d = maxWaitDebounce(fn, 250, 2000);
    for (let i = 0; i < 20; i++) {
      d();
      vi.advanceTimersByTime(100);
    }
    // 2 s of events: a plain trailing debounce would have fired 0 times here
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(1);
    vi.advanceTimersByTime(300); // quiet tail
    expect(fn.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('a long steady stream (10 s) refreshes about every 2 s, not once per event', () => {
    const fn = vi.fn();
    const d = maxWaitDebounce(fn, 250, 2000);
    for (let i = 0; i < 100; i++) {
      d();
      vi.advanceTimersByTime(100);
    }
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('cancel drops a pending refresh and resets the window', () => {
    const fn = vi.fn();
    const d = maxWaitDebounce(fn, 250, 2000);
    d();
    d.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    d();
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
