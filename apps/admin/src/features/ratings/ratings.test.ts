import { describe, expect, it } from 'vitest';
import { parseRatingsSummary } from './api';
import {
  PRESETS,
  barColor,
  barPercent,
  dateArgs,
  filledStars,
  formatRatingDate,
  parsePreset,
  presetArgs,
  validRange,
} from './filters';

const dist = { '1': 1, '2': 1, '3': 1, '4': 1, '5': 2 };

describe('presets', () => {
  it('map to the database arguments (stars range, comment only)', () => {
    expect(presetArgs('all')).toEqual({ p_min_stars: 1, p_max_stars: 5, p_with_comment: false });
    expect(presetArgs('5')).toEqual({ p_min_stars: 5, p_max_stars: 5, p_with_comment: false });
    expect(presetArgs('4')).toEqual({ p_min_stars: 4, p_max_stars: 4, p_with_comment: false });
    expect(presetArgs('low3')).toEqual({ p_min_stars: 1, p_max_stars: 3, p_with_comment: false });
    expect(presetArgs('low2')).toEqual({ p_min_stars: 1, p_max_stars: 2, p_with_comment: false });
    expect(presetArgs('comment')).toEqual({ p_min_stars: 1, p_max_stars: 5, p_with_comment: true });
  });
  it('follow the approved design order and wording', () => {
    expect(PRESETS.map((p) => p.label)).toEqual([
      'الكل',
      '5 نجوم',
      '4',
      '3 وأقل',
      'نجمة ونجمتان',
      'بيها تعليق',
    ]);
  });
  it('an unknown value falls back to "all"', () => {
    expect(parsePreset('zzz')).toBe('all');
    expect(parsePreset(null)).toBe('all');
    expect(parsePreset('low3')).toBe('low3');
  });
});

describe('range', () => {
  it('valid, empty, reversed and malformed', () => {
    expect(validRange(null, null)).toBe(true);
    expect(validRange('2026-11-01', null)).toBe(true);
    expect(validRange('2026-11-01', '2026-11-16')).toBe(true);
    expect(validRange('2026-11-16', '2026-11-01')).toBe(false);
    expect(validRange('2026-13-01', null)).toBe(false);
  });
  it('only the given ends are sent', () => {
    expect(dateArgs({ preset: 'all', from: null, to: null })).toEqual({});
    expect(dateArgs({ preset: 'all', from: '2026-11-01', to: null })).toEqual({
      p_from: '2026-11-01',
    });
  });
});

describe('formatRatingDate (Baghdad day, Latin digits)', () => {
  const now = '2026-11-16T09:30:00Z'; // 12:30 بغداد
  it('today shows the time, yesterday its name', () => {
    expect(formatRatingDate('2026-11-16T07:20:00Z', now)).toBe('اليوم 10:20 ص');
    expect(formatRatingDate('2026-11-15T20:59:00Z', now)).toBe('أمس'); // 23:59 بغداد أمس
  });
  it('23:59 Baghdad is that day, 00:00 the next', () => {
    expect(formatRatingDate('2026-11-15T21:00:00Z', now)).toMatch(/^اليوم /); // 00:00 بغداد اليوم
    expect(formatRatingDate('2026-11-14T20:59:00Z', now)).toBe('14 تشرين الثاني');
  });
  it('older days: day and Iraqi month name; other year adds the year', () => {
    expect(formatRatingDate('2026-11-13T10:00:00Z', now)).toBe('13 تشرين الثاني');
    expect(formatRatingDate('2026-01-05T10:00:00Z', now)).toBe('5 كانون الثاني');
    expect(formatRatingDate('2025-12-31T10:00:00Z', now)).toBe('31 كانون الأول 2025');
  });
});

describe('header helpers', () => {
  it('filled stars are the whole part of the average (4.6 → 4, as drawn)', () => {
    expect(filledStars(4.6)).toBe(4);
    expect(filledStars(5)).toBe(5);
    expect(filledStars(1.2)).toBe(1);
    expect(filledStars(null)).toBe(0);
  });
  it('bar colours: 4-5 green, 3 amber, 1-2 red', () => {
    expect([5, 4, 3, 2, 1].map(barColor)).toEqual([
      'primary',
      'primary',
      'star',
      'danger',
      'danger',
    ]);
  });
  it('bar width relative to the largest count', () => {
    expect(barPercent(171, 171)).toBe(100);
    expect(barPercent(52, 171)).toBe(30);
    expect(barPercent(0, 0)).toBe(0);
  });
});

describe('parseRatingsSummary', () => {
  it('accepts the database shape, including an empty set', () => {
    expect(parseRatingsSummary({ count: 6, avg: 3.3, distribution: dist }).avg).toBe(3.3);
    expect(
      parseRatingsSummary({ count: 0, avg: null, distribution: { ...dist, '5': 0 } }).count,
    ).toBe(0);
  });
  it('rejects fractions, bad averages and missing buckets', () => {
    expect(() => parseRatingsSummary({ count: 1.5, avg: 3, distribution: dist })).toThrow('count');
    expect(() => parseRatingsSummary({ count: 1, avg: 6, distribution: dist })).toThrow('avg');
    expect(() => parseRatingsSummary({ count: 1, avg: 3, distribution: { '1': 1 } })).toThrow(
      'distribution.2',
    );
    expect(() => parseRatingsSummary(null)).toThrow('RATINGS_SHAPE');
  });
});
