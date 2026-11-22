import { describe, expect, it } from 'vitest';
import { keyFor, newKeyState, rotateKey } from './idempotency';

let n = 0;
const gen = () => `key-${++n}`;

describe('handover idempotency key', () => {
  it('is generated once when the dialog opens and reused for retries of the same amount', () => {
    const s = newKeyState(gen);
    const a = keyFor(s, 48_750, gen);
    const b = keyFor(a.state, 48_750, gen);
    expect(b.key).toBe(a.key);
  });

  it('changes when the amount changes', () => {
    const s = newKeyState(gen);
    const a = keyFor(s, 48_750, gen);
    const b = keyFor(a.state, 50_000, gen);
    expect(b.key).not.toBe(a.key);
  });

  it('reusing the old amount after a change gets a fresh key again (no stale replay)', () => {
    const s = newKeyState(gen);
    const a = keyFor(s, 1_000, gen);
    const b = keyFor(a.state, 2_000, gen);
    const c = keyFor(b.state, 1_000, gen);
    expect(c.key).not.toBe(a.key);
    expect(c.key).not.toBe(b.key);
  });

  it('rotateKey (after CASH_BALANCE_CHANGED) always yields a different key even for the same amount', () => {
    const s = newKeyState(gen);
    const a = keyFor(s, 48_750, gen);
    const r = rotateKey(a.state, gen);
    const b = keyFor(r, 48_750, gen);
    expect(b.key).not.toBe(a.key);
  });
});
