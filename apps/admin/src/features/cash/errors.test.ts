import { describe, expect, it } from 'vitest';
import {
  balanceChangedMessage,
  compareRecorded,
  correctionFailureMessage,
  handoverFailure,
  recordedMismatchWarning,
} from './errors';

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

  it('R4 M2: NO_CASH_OUTSTANDING keeps the dialog open to show what was recorded, and refreshes', () => {
    const f = handoverFailure(pg('NO_CASH_OUTSTANDING'));
    expect(f.close).toBe(false);
    expect(f.lookup).toBe(true);
    expect(f.refresh).toBe(true);
    expect(f.rotateKey).toBe(true);
    expect(f.message).toContain('قبل شوية');
  });

  it('R4 L2: INVALID_REQUEST idempotency_key (same key, different request) is "already recorded" too', () => {
    const f = handoverFailure(pg('INVALID_REQUEST', 'idempotency_key'));
    expect(f.lookup).toBe(true);
    expect(f.rotateKey).toBe(true);
    const other = handoverFailure(pg('INVALID_REQUEST', 'p_note'));
    expect(other.lookup).toBe(false);
  });

  it('R4 L8: the same order count with a new amount blames the fee setting, not a new delivery', () => {
    const f = handoverFailure(
      pg('CASH_BALANCE_CHANGED', '{"expected_iqd": 40000, "order_count": 4}'),
      4,
    );
    expect(f.message).toContain('تغيّر إعداد أجرة التوصيل');
    expect(f.message).not.toContain('توصيل جديد');
    expect(f.message).toContain('40,000');
    const more = handoverFailure(
      pg('CASH_BALANCE_CHANGED', '{"expected_iqd": 52000, "order_count": 5}'),
      4,
    );
    expect(more.message).toContain('وصل توصيل جديد');
    expect(balanceChangedMessage(null)).toContain('عدّ من جديد');
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

describe('what was recorded vs what is on screen (R4 M2)', () => {
  const recorded = { received_iqd: 40_000, note: null };
  it('matches: no warning', () => {
    expect(recordedMismatchWarning(recorded, { amount: 40_000, note: '  ' })).toBeNull();
    expect(compareRecorded(recorded, { amount: 40_000, note: null })).toEqual({
      amountDiffers: false,
      noteDiffers: false,
    });
  });
  it('a different amount names both amounts and points to the admin correction', () => {
    const w = recordedMismatchWarning(recorded, { amount: 39_750, note: 'عدّيت ثاني' });
    expect(w).toContain('40,000');
    expect(w).toContain('39,750');
    expect(w).toContain('المدير يصحّحه');
  });
  it('the same amount with a different note still warns', () => {
    const w = recordedMismatchWarning(
      { received_iqd: 39_750, note: 'ناقص' },
      { amount: 39_750, note: 'ناقص ربع' },
    );
    expect(w).toContain('الملاحظة');
  });
});

describe('correctionFailureMessage (R4 L6)', () => {
  it('HANDOVER_CHANGED shows the amount stored now', () => {
    const m = correctionFailureMessage(pg('HANDOVER_CHANGED', '39500'));
    expect(m).toContain('أدمن ثاني');
    expect(m).toContain('39,500');
  });
  it('HANDOVER_CHANGED without a readable detail still explains', () => {
    expect(correctionFailureMessage(pg('HANDOVER_CHANGED', 'x'))).toContain('أدمن ثاني');
  });
  it('other errors use the shared messages', () => {
    expect(correctionFailureMessage(pg('NOTE_REQUIRED'))).toContain('ملاحظة');
  });
});
