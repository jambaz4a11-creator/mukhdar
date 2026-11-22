// T42 (SPEC-cash §5): قراءة الكاش منذ آخر تسليم: الملخص (K10)، سجل التسليمات (K11، keyset)، الطلبات بذمته.
import {
  CASH_HISTORY_PAGE,
  fetchCashHistory,
  fetchCashSummary,
  fetchInHandOrders,
  IN_HAND_LIMIT,
  handoverBadge,
} from '../features/cash/cash';
import { createFakeSupabase, opArgs, type Call } from '../test-utils/fakeSupabase';

describe('fetchCashSummary (driver_cash_summary)', () => {
  it('calls the function with no arguments and maps the single row', async () => {
    const fake = createFakeSupabase(() => ({
      data: [
        {
          outstanding_iqd: 74750,
          order_count: 2,
          oldest_delivered_at: '2026-11-19T06:50:00Z',
          last_handover_at: '2026-11-18T15:00:00Z',
          last_received_iqd: 20000,
          last_difference_iqd: -250,
          includes_delivery_fee: true,
        },
      ],
      error: null,
    }));
    const r = await fetchCashSummary(fake.client as never);
    expect(fake.calls[0]?.table).toBe('rpc:driver_cash_summary');
    expect(r).toEqual({
      ok: true,
      summary: {
        outstanding_iqd: 74750,
        order_count: 2,
        oldest_delivered_at: '2026-11-19T06:50:00Z',
        last_handover_at: '2026-11-18T15:00:00Z',
        last_received_iqd: 20000,
        last_difference_iqd: -250,
        includes_delivery_fee: true,
      },
    });
  });

  it('no data: zeros and nulls (never handed over)', async () => {
    const fake = createFakeSupabase(() => ({
      data: [
        {
          outstanding_iqd: 0,
          order_count: 0,
          oldest_delivered_at: null,
          last_handover_at: null,
          last_received_iqd: null,
          last_difference_iqd: null,
          includes_delivery_fee: false,
        },
      ],
      error: null,
    }));
    const r = await fetchCashSummary(fake.client as never);
    expect(r).toMatchObject({
      ok: true,
      summary: { outstanding_iqd: 0, last_handover_at: null, includes_delivery_fee: false },
    });
  });

  it('bigint arriving as a string is converted to a number', async () => {
    const fake = createFakeSupabase(() => ({
      data: [{ outstanding_iqd: '12500', order_count: '1', includes_delivery_fee: true }],
      error: null,
    }));
    expect(await fetchCashSummary(fake.client as never)).toMatchObject({
      ok: true,
      summary: { outstanding_iqd: 12500, order_count: 1, last_handover_at: null },
    });
  });

  it('error -> not ok with an Arabic message; an empty response is an error too', async () => {
    const bad = createFakeSupabase(() => ({ data: null, error: { message: 'NOT_ALLOWED' } }));
    expect(await fetchCashSummary(bad.client as never)).toMatchObject({ ok: false });
    const empty = createFakeSupabase(() => ({ data: [], error: null }));
    expect(await fetchCashSummary(empty.client as never)).toMatchObject({ ok: false });
  });
});

describe('fetchCashHistory (my_cash_handovers, keyset)', () => {
  const row = (n: number) => ({
    id: `h${n}`,
    recorded_at: `2026-11-${String(20 - n).padStart(2, '0')}T10:00:00Z`,
    order_count: 3,
    expected_iqd: 10000,
    received_iqd: 10000,
    difference_iqd: 0,
    includes_delivery_fee: true,
    note: null,
    recorded_by_name: 'سعد',
    corrected_at: null,
  });

  it('first page: 20 rows, no cursor', async () => {
    const fake = createFakeSupabase(() => ({ data: [row(1)], error: null }));
    await fetchCashHistory(fake.client as never, null);
    const c = fake.calls[0] as Call;
    expect(c.table).toBe('rpc:my_cash_handovers');
    expect(opArgs(c, 'rpc')).toEqual([{ p_limit: CASH_HISTORY_PAGE }]);
    expect(CASH_HISTORY_PAGE).toBe(20);
  });

  it('next page: the cursor is the last row (recorded_at, id)', async () => {
    const fake = createFakeSupabase(() => ({ data: [row(1)], error: null }));
    await fetchCashHistory(fake.client as never, { recorded_at: '2026-11-10T10:00:00Z', id: 'hx' });
    expect(opArgs(fake.calls[0] as Call, 'rpc')).toEqual([
      { p_limit: 20, p_before_at: '2026-11-10T10:00:00Z', p_before_id: 'hx' },
    ]);
  });

  it('a full page gives a next cursor (the last row); a short page ends the list', async () => {
    const full = Array.from({ length: 20 }, (_, i) => row(i + 1));
    const a = createFakeSupabase(() => ({ data: full, error: null }));
    const r1 = await fetchCashHistory(a.client as never, null);
    expect(r1).toMatchObject({ ok: true, next: { recorded_at: full[19]?.recorded_at, id: 'h20' } });
    expect(r1.ok && r1.items).toHaveLength(20);

    const b = createFakeSupabase(() => ({ data: full.slice(0, 5), error: null }));
    expect(await fetchCashHistory(b.client as never, null)).toMatchObject({ ok: true, next: null });
  });

  it('error -> not ok', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: { message: 'x' } }));
    expect(await fetchCashHistory(fake.client as never, null)).toMatchObject({ ok: false });
  });
});

describe('fetchInHandOrders (display only, existing RLS)', () => {
  it('my delivered orders not yet linked to a handover, newest first, max 200', async () => {
    const fake = createFakeSupabase(() => ({ data: [], error: null }));
    await fetchInHandOrders(fake.client as never, 'me');
    const c = fake.calls[0] as Call;
    expect(c.table).toBe('orders');
    expect(c.ops.filter(([n]) => n === 'eq').map(([, a]) => a)).toEqual([
      ['driver_id', 'me'],
      ['status', 'delivered'],
    ]);
    expect(opArgs(c, 'is')).toEqual(['cash_handover_id', null]);
    expect(opArgs(c, 'order')).toEqual(['delivered_at', { ascending: false }]);
    expect(opArgs(c, 'limit')).toEqual([200]);
    expect(IN_HAND_LIMIT).toBe(200);
  });

  it('error -> not ok', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: { message: 'x' } }));
    expect(await fetchInHandOrders(fake.client as never, 'me')).toMatchObject({ ok: false });
  });
});

describe('handoverBadge', () => {
  it('negative = shortage, positive = overage, zero = none', () => {
    expect(handoverBadge(-250)).toEqual({ kind: 'shortage', amount: 250 });
    expect(handoverBadge(1000)).toEqual({ kind: 'overage', amount: 1000 });
    expect(handoverBadge(0)).toBeNull();
    expect(handoverBadge(null)).toBeNull();
  });
});
