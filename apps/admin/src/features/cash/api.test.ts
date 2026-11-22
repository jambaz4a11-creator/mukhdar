import { describe, expect, it } from 'vitest';
import { HISTORY_PAGE, nextCursor, type HandoverRow } from './api';

const row = (i: number): HandoverRow => ({
  id: `id-${i}`,
  driver_id: 'd',
  driver_name: 'علي',
  recorded_at: `2026-11-22T10:${String(i % 60).padStart(2, '0')}:00Z`,
  recorded_by_name: 'م',
  recorded_by_role: 'staff',
  order_count: 1,
  expected_iqd: 1000,
  received_iqd: 1000,
  difference_iqd: 0,
  includes_delivery_fee: true,
  note: null,
  original_received_iqd: null,
  corrected_at: null,
  corrected_by_name: null,
});

describe('history keyset paging (50 per page)', () => {
  it('a full page continues from the last row (recorded_at, id)', () => {
    const rows = Array.from({ length: HISTORY_PAGE }, (_, i) => row(i));
    expect(nextCursor(rows)).toEqual({ at: rows[49]?.recorded_at, id: 'id-49' });
  });
  it('a short page is the end', () => {
    expect(nextCursor(Array.from({ length: HISTORY_PAGE - 1 }, (_, i) => row(i)))).toBeUndefined();
    expect(nextCursor([])).toBeUndefined();
  });
});
