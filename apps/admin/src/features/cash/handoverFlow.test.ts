// R4 T8 (M2): the dialog's sequence after a lost response, walked through the same pure functions the dialog uses
// (HandoverDialog.tsx: keyFor → recordHandover → handoverFailure → recordedMismatchWarning). The browser version of
// this sequence, with a really lost response, is in e2e/cash.spec.ts.
import { describe, expect, it } from 'vitest';
import { handoverFailure, recordedMismatchWarning } from './errors';
import { keyFor, newKeyState } from './idempotency';

let n = 0;
const gen = () => `key-${++n}`;
const pg = (message: string, details?: string) => ({
  message,
  details: details ?? null,
  code: 'P0001',
});

describe('lost response, then the amount is changed, then NO_CASH_OUTSTANDING', () => {
  it('shows the stored 40,000 and warns that it differs from the 39,750 now typed', () => {
    // 1) staff types 40,000 and confirms: the server commits, the response is lost
    let keys = newKeyState(gen);
    const first = keyFor(keys, 40_000, gen, null);
    keys = first.state;
    const lost = handoverFailure(new TypeError('Failed to fetch'), 4);
    expect(lost.code).toBeNull();
    expect(lost.rotateKey).toBe(false); // outcome unknown: a plain retry reuses the key (replayed by the server)
    expect(lost.lookup).toBe(false);

    // 2) they recount and type 39,750 with a note: a different request gets a new key
    const second = keyFor(keys, 39_750, gen, 'عدّيت مرة ثانية');
    expect(second.key).not.toBe(first.key);

    // 3) the server has no balance left for the driver
    const already = handoverFailure(pg('NO_CASH_OUTSTANDING'), 4);
    expect(already.lookup).toBe(true);
    expect(already.close).toBe(false); // no silent close with "recorded a while ago"

    // 4) the dialog loads the latest handover and compares it with what was just sent
    const warning = recordedMismatchWarning(
      { received_iqd: 40_000, note: null },
      { amount: 39_750, note: 'عدّيت مرة ثانية' },
    );
    expect(warning).toContain('40,000');
    expect(warning).toContain('39,750');
  });

  it('a plain retry of the same amount and note reuses the key (the server replays the first result)', () => {
    let keys = newKeyState(gen);
    const first = keyFor(keys, 40_000, gen, null);
    keys = first.state;
    expect(keyFor(keys, 40_000, gen, null).key).toBe(first.key);
  });
});
