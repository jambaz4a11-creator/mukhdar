import { describe, expect, it } from 'vitest';
import { NOTE_MAX, noteRequired, parseReceived, validateNote } from './amount';

const EXPECTED = 50_000;

describe('parseReceived', () => {
  it('an empty or blank field is "empty" (never pre-filled, no error yet)', () => {
    expect(parseReceived('', EXPECTED)).toEqual({ state: 'empty' });
    expect(parseReceived('   ', EXPECTED)).toEqual({ state: 'empty' });
  });

  it('accepts Latin and Arabic-Indic digits', () => {
    expect(parseReceived('48750', EXPECTED)).toEqual({ state: 'ok', value: 48_750 });
    expect(parseReceived('٤٨٧٥٠', EXPECTED)).toEqual({ state: 'ok', value: 48_750 });
    expect(parseReceived('۴۸۷۵۰', EXPECTED)).toEqual({ state: 'ok', value: 48_750 });
  });

  it('accepts thousands separators and spaces', () => {
    expect(parseReceived('48,750', EXPECTED)).toEqual({ state: 'ok', value: 48_750 });
    expect(parseReceived('٤٨٬٧٥٠', EXPECTED)).toEqual({ state: 'ok', value: 48_750 });
    expect(parseReceived(' 48 750 ', EXPECTED)).toEqual({ state: 'ok', value: 48_750 });
  });

  it('zero is valid (nothing handed over)', () => {
    expect(parseReceived('0', EXPECTED)).toEqual({ state: 'ok', value: 0 });
  });

  it('rejects values that are not multiples of 250', () => {
    const r = parseReceived('48760', EXPECTED);
    expect(r.state).toBe('invalid');
    if (r.state === 'invalid') expect(r.message).toContain('250');
  });

  it.each(['-250', '12.5', '12٫5', 'abc', '12a', '1e3'])('rejects %s', (raw) => {
    expect(parseReceived(raw, EXPECTED).state).toBe('invalid');
  });

  it('rejects an amount above expected + 10,000,000 (a stray extra zero), allows exactly the limit', () => {
    expect(parseReceived(String(EXPECTED + 10_000_000), EXPECTED)).toEqual({
      state: 'ok',
      value: EXPECTED + 10_000_000,
    });
    expect(parseReceived(String(EXPECTED + 10_000_250), EXPECTED).state).toBe('invalid');
  });

  it('rejects absurdly long input without overflow', () => {
    expect(parseReceived('9'.repeat(30), EXPECTED).state).toBe('invalid');
  });
});

describe('note rules', () => {
  it('a note is required for any difference, never for a match', () => {
    expect(noteRequired({ kind: 'match', amount: 0 })).toBe(false);
    expect(noteRequired({ kind: 'shortage', amount: 250 })).toBe(true);
    expect(noteRequired({ kind: 'overage', amount: 250 })).toBe(true);
  });

  it('validateNote: blank is missing when required, over 300 is too long, otherwise ok', () => {
    const missing = validateNote('', true);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toContain('ملاحظة');
    expect(validateNote('   ', true).ok).toBe(false);
    expect(validateNote('', false)).toEqual({ ok: true, value: null });
    expect(validateNote(' نقص ورقة ', true)).toEqual({ ok: true, value: 'نقص ورقة' });
    expect(validateNote('x'.repeat(NOTE_MAX), true).ok).toBe(true);
    expect(validateNote('x'.repeat(NOTE_MAX + 1), true).ok).toBe(false);
  });
});
