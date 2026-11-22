import { describe, expect, it } from 'vitest';
import { handoverFailure } from './errors';

const pg = (message: string, details?: string) => ({
  message,
  details: details ?? null,
  code: 'P0001',
});

describe('handoverFailure', () => {
  it('CASH_BALANCE_CHANGED reads the new expected amount and count from detail, refreshes and clears the amount', () => {
    const f = handoverFailure(
      pg('CASH_BALANCE_CHANGED', '{"expected_iqd": 62500, "order_count": 6}'),
    );
    expect(f.code).toBe('CASH_BALANCE_CHANGED');
    expect(f.balance).toEqual({ expected_iqd: 62_500, order_count: 6 });
    expect(f.clearAmount).toBe(true);
    expect(f.refresh).toBe(true);
    expect(f.close).toBe(false);
    expect(f.rotateKey).toBe(true);
    expect(f.message).toContain('62,500');
    expect(f.message).toContain('عدّ من جديد');
  });

  it('CASH_BALANCE_CHANGED with unreadable detail still clears and refreshes (no invented amount)', () => {
    for (const details of [
      undefined,
      'garbage',
      '{"expected_iqd": "x"}',
      '{"expected_iqd": 250.5, "order_count": 1}',
    ]) {
      const f = handoverFailure(pg('CASH_BALANCE_CHANGED', details));
      expect(f.balance).toBeNull();
      expect(f.clearAmount).toBe(true);
      expect(f.refresh).toBe(true);
    }
  });

  it('NO_CASH_OUTSTANDING closes the dialog and refreshes', () => {
    const f = handoverFailure(pg('NO_CASH_OUTSTANDING'));
    expect(f.close).toBe(true);
    expect(f.refresh).toBe(true);
    expect(f.message).toContain('قبل شوية');
  });

  it('NOTE_REQUIRED and CASH_AMOUNT_INVALID keep the dialog and the typed amount', () => {
    for (const code of ['NOTE_REQUIRED', 'CASH_AMOUNT_INVALID']) {
      const f = handoverFailure(pg(code));
      expect(f.close).toBe(false);
      expect(f.clearAmount).toBe(false);
      expect(f.refresh).toBe(false);
    }
  });

  it('a network drop is retryable with the SAME key (outcome unknown), and never shows raw text', () => {
    const f = handoverFailure(new TypeError('Failed to fetch'));
    expect(f.rotateKey).toBe(false);
    expect(f.message).not.toContain('Failed to fetch');
  });

  it('an unknown server error (e.g. deadlock) is generic and retryable with the same key', () => {
    const f = handoverFailure(pg('deadlock detected'));
    expect(f.rotateKey).toBe(false);
    expect(f.message).not.toContain('deadlock');
  });
});
