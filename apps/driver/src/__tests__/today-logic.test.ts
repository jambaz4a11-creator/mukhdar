// سجل اليوم (SPEC-driver §2.9): الاستعلام، المجموع، تسمية التاريخ بتوقيت بغداد.
import { baghdadDayRange } from '@mukhdar/shared';
import { formatBaghdadDateLabel, groupDigits } from '../features/today/date';
import { fetchToday } from '../features/today/today';
import { createFakeSupabase, opArgs, type Call } from '../test-utils/fakeSupabase';

const NOW = Date.parse('2026-11-19T10:00:00Z');

describe('fetchToday', () => {
  it('reads my delivered orders inside the Baghdad day, newest first, max 200', async () => {
    const { client, calls } = createFakeSupabase(() => ({ data: [], error: null }));
    await fetchToday(client as never, 'me', NOW);
    const c = calls[0] as Call;
    const range = baghdadDayRange(NOW);
    expect(c.table).toBe('orders');
    expect(c.ops.filter(([n]) => n === 'eq').map(([, a]) => a)).toEqual([
      ['driver_id', 'me'],
      ['status', 'delivered'],
    ]);
    expect(opArgs(c, 'gte')).toEqual(['delivered_at', range.from]);
    expect(opArgs(c, 'lt')).toEqual(['delivered_at', range.to]);
    expect(opArgs(c, 'order')).toEqual(['delivered_at', { ascending: false }]);
    expect(opArgs(c, 'limit')).toEqual([200]);
  });

  it('cash = sum of total_iqd, count = rows (matches a manual SQL sum)', async () => {
    const rows = [
      {
        id: 'a',
        order_number: 1043,
        total_iqd: 9000,
        delivered_at: '2026-11-19T07:21:00Z',
        address_snapshot: { subsection: 'A3', building: '14' },
      },
      {
        id: 'b',
        order_number: 1039,
        total_iqd: 6500,
        delivered_at: '2026-11-19T06:50:00Z',
        address_snapshot: { subsection: 'B1', building: '12' },
      },
    ];
    const { client } = createFakeSupabase(() => ({ data: rows, error: null }));
    expect(await fetchToday(client as never, 'me', NOW)).toMatchObject({
      ok: true,
      cash: 15500,
      count: 2,
    });
  });

  it('error -> not ok with a message', async () => {
    const { client } = createFakeSupabase(() => ({
      data: null,
      error: { message: 'Network request failed' },
    }));
    expect(await fetchToday(client as never, 'me', NOW)).toMatchObject({ ok: false });
  });
});

describe('date label and digits', () => {
  it('Thursday 19 تشرين الثاني (Baghdad day)', () => {
    expect(formatBaghdadDateLabel(NOW)).toBe('الخميس 19 تشرين الثاني');
  });
  it('after 21:00Z it is already the next Baghdad day', () => {
    expect(formatBaghdadDateLabel(Date.parse('2026-11-19T21:30:00Z'))).toBe(
      'الجمعة 20 تشرين الثاني',
    );
  });
  it('groupDigits', () => {
    expect(groupDigits(74750)).toBe('74,750');
    expect(groupDigits(0)).toBe('0');
  });
});
