// دوال السائق (DRIVER-API §3-§4) مع Supabase مزيف: الاستعلامات، السباق، NOT_ALLOWED ← إعادة فحص الحارس (R1 L6).
import { useAuth } from '../features/auth/store';
import { acceptOrder, fetchAvailableOrders } from '../features/orders/available';
import { fetchOrderDetail } from '../features/orders/detail';
import { guardDriverError } from '../features/orders/driverErrors';
import { fetchMyOrders } from '../features/orders/mine';
import { setOrderStatus } from '../features/orders/transitions';
import { createFakeSupabase, opArgs, type Call } from '../test-utils/fakeSupabase';

const err = (message: string, code = 'P0001') => ({ message, code, details: null });

describe('fetchAvailableOrders', () => {
  it('calls available_orders(20) and returns the rows', async () => {
    const rows = [
      {
        id: 'o1',
        order_number: 1048,
        status: 'ready',
        sector: 'قطاع A',
        subsection: 'A3',
        building: '12',
        item_count: 9,
        line_count: 6,
        total_iqd: 12500,
        created_at: '2026-11-20T09:00:00Z',
      },
    ];
    const { client, calls } = createFakeSupabase(() => ({ data: rows, error: null }));
    const result = await fetchAvailableOrders(client as never);
    expect(calls[0]?.table).toBe('rpc:available_orders');
    expect(opArgs(calls[0] as Call, 'rpc')).toEqual([{ p_limit: 20 }]);
    expect(result).toEqual({ ok: true, orders: rows });
  });
  it('NOT_ALLOWED is reported as notAllowed (guard recheck), not as a message', async () => {
    const { client } = createFakeSupabase(() => ({
      data: null,
      error: err('NOT_ALLOWED', '42501'),
    }));
    expect(await fetchAvailableOrders(client as never)).toEqual({ ok: false, notAllowed: true });
  });
  it('network error -> Arabic message', async () => {
    const { client } = createFakeSupabase(() => ({
      data: null,
      error: { message: 'TypeError: Network request failed' },
    }));
    const r = await fetchAvailableOrders(client as never);
    expect(r).toMatchObject({ ok: false, notAllowed: false });
  });
});

describe('acceptOrder (race-safe)', () => {
  it('success returns the order id', async () => {
    const { client, calls } = createFakeSupabase(() => ({ data: { id: 'o1' }, error: null }));
    expect(await acceptOrder(client as never, 'o1')).toEqual({ ok: true, orderId: 'o1' });
    expect(opArgs(calls[0] as Call, 'rpc')).toEqual([{ p_order_id: 'o1' }]);
  });
  it('ORDER_NOT_AVAILABLE -> taken (a second driver won)', async () => {
    const { client } = createFakeSupabase(() => ({
      data: null,
      error: err('ORDER_NOT_AVAILABLE'),
    }));
    expect(await acceptOrder(client as never, 'o1')).toEqual({ ok: false, reason: 'taken' });
  });
  it('NOT_ALLOWED -> not-allowed', async () => {
    const { client } = createFakeSupabase(() => ({
      data: null,
      error: err('NOT_ALLOWED', '42501'),
    }));
    expect(await acceptOrder(client as never, 'o1')).toEqual({
      ok: false,
      reason: 'not-allowed',
    });
  });
  it('anything else -> error', async () => {
    const { client } = createFakeSupabase(() => ({ data: null, error: err('boom') }));
    expect(await acceptOrder(client as never, 'o1')).toMatchObject({
      ok: false,
      reason: 'error',
    });
  });
});

describe('fetchMyOrders / fetchOrderDetail (DRIVER-API §4 queries)', () => {
  it('my orders: driver_id = me, non-final statuses, oldest first', async () => {
    const { client, calls } = createFakeSupabase(() => ({ data: [], error: null }));
    await fetchMyOrders(client as never, 'me');
    const c = calls[0] as Call;
    expect(c.table).toBe('orders');
    expect(opArgs(c, 'eq')).toEqual(['driver_id', 'me']);
    expect(opArgs(c, 'in')).toEqual(['status', ['preparing', 'ready', 'out_for_delivery']]);
    expect(opArgs(c, 'order')).toEqual(['created_at']);
  });
  it('detail: the order with its items by id', async () => {
    const { client, calls } = createFakeSupabase(() => ({ data: { id: 'o1' }, error: null }));
    const r = await fetchOrderDetail(client as never, 'o1');
    expect(r).toEqual({ ok: true, order: { id: 'o1' } });
    expect(String(opArgs(calls[0] as Call, 'select')?.[0])).toContain('order_items(');
    expect(opArgs(calls[0] as Call, 'eq')).toEqual(['id', 'o1']);
  });
  it('detail: no row (not mine any more) -> gone', async () => {
    const { client } = createFakeSupabase(() => ({ data: null, error: null }));
    expect(await fetchOrderDetail(client as never, 'o1')).toEqual({ ok: false, reason: 'gone' });
  });
});

describe('setOrderStatus', () => {
  it('sends only id and status (drivers never send p_return_stock)', async () => {
    const { client, calls } = createFakeSupabase(() => ({
      data: { id: 'o1', status: 'out_for_delivery' },
      error: null,
    }));
    const r = await setOrderStatus(client as never, 'o1', 'out_for_delivery');
    expect(opArgs(calls[0] as Call, 'rpc')).toEqual([
      { p_order_id: 'o1', p_status: 'out_for_delivery' },
    ]);
    expect(r).toMatchObject({ ok: true });
  });
  it('INVALID_TRANSITION -> invalid-transition (refetch)', async () => {
    const { client } = createFakeSupabase(() => ({
      data: null,
      error: err('INVALID_TRANSITION'),
    }));
    expect(await setOrderStatus(client as never, 'o1', 'delivered')).toMatchObject({
      ok: false,
      reason: 'invalid-transition',
    });
  });
  it('NOT_ALLOWED -> not-allowed (no longer mine)', async () => {
    const { client } = createFakeSupabase(() => ({
      data: null,
      error: err('NOT_ALLOWED', '42501'),
    }));
    expect(await setOrderStatus(client as never, 'o1', 'delivered')).toMatchObject({
      ok: false,
      reason: 'not-allowed',
    });
  });
  it('NOT_AUTHENTICATED is also a guard recheck', async () => {
    const { client } = createFakeSupabase(() => ({
      data: null,
      error: err('NOT_AUTHENTICATED', '28000'),
    }));
    expect(await setOrderStatus(client as never, 'o1', 'delivered')).toMatchObject({
      ok: false,
      reason: 'not-allowed',
    });
  });
});

describe('R1 L6: NOT_ALLOWED re-runs the guard (refreshProfile)', () => {
  const driver = {
    role: 'driver',
    is_active: true,
    must_change_pin: false,
    full_name: 'ع',
    phone: '9647801112222',
  };
  beforeEach(() => {
    useAuth.setState({
      ready: true,
      session: { user: { id: 'u1' } } as never,
      profile: driver,
      profileError: false,
      hasRegistration: false,
      sessionOffline: false,
    });
  });
  it('profile is re-read: now "not a driver" (the guard then redirects to not-driver)', async () => {
    const { client, calls } = createFakeSupabase(() => ({
      data: { ...driver, role: 'customer' },
      error: null,
    }));
    await guardDriverError(client as never);
    expect(calls.some((c) => c.table === 'profiles')).toBe(true);
    expect(useAuth.getState().profile?.role).toBe('customer');
  });
  it('flagged account: re-read shows must_change_pin (the guard then redirects to change-pin)', async () => {
    const { client } = createFakeSupabase(() => ({
      data: { ...driver, must_change_pin: true },
      error: null,
    }));
    await guardDriverError(client as never);
    expect(useAuth.getState().profile?.must_change_pin).toBe(true);
  });
  it('an unreadable profile (profileError) is recovered by the recheck', async () => {
    useAuth.setState({ profile: null, profileError: true });
    const { client } = createFakeSupabase(() => ({ data: driver, error: null }));
    await guardDriverError(client as never);
    expect(useAuth.getState().profileError).toBe(false);
    expect(useAuth.getState().profile?.role).toBe('driver');
  });
});
