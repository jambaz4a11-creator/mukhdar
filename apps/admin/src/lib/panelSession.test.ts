import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOrdersPage, fetchTabCounts } from '@/features/orders/api';
import type { OrdersFilters } from '@/features/orders/filters';
import {
  IDLE_LOGIN_URL,
  PanelSessionExpiredError,
  assertPanelSessionAlive,
  isPanelSessionAlive,
  leaveExpiredSession,
  resetLeavingForTests,
} from './panelSession';

const rpcClient = (result: { data?: unknown; error?: unknown } | Error) => ({
  rpc: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
});

afterEach(() => resetLeavingForTests());

describe('panel session alive (T23 F M4)', () => {
  it('true / false from panel_session_alive; null on any error (a blip never logs anyone out)', async () => {
    expect(await isPanelSessionAlive(rpcClient({ data: true, error: null }) as never)).toBe(true);
    expect(await isPanelSessionAlive(rpcClient({ data: false, error: null }) as never)).toBe(false);
    expect(
      await isPanelSessionAlive(rpcClient({ data: null, error: { message: 'x' } }) as never),
    ).toBeNull();
    expect(await isPanelSessionAlive(rpcClient(new Error('fetch failed')) as never)).toBeNull();
  });

  it('assert throws only when the server says the session is over', async () => {
    await expect(
      assertPanelSessionAlive(rpcClient({ data: false, error: null }) as never),
    ).rejects.toBeInstanceOf(PanelSessionExpiredError);
    await expect(
      assertPanelSessionAlive(rpcClient({ data: true, error: null }) as never),
    ).resolves.toBeUndefined();
    await expect(
      assertPanelSessionAlive(rpcClient(new Error('offline')) as never),
    ).resolves.toBeUndefined();
  });

  it('leaving signs out locally and goes to /login?reason=idle once', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const go = vi.fn();
    await leaveExpiredSession({ auth: { signOut } } as never, go);
    await leaveExpiredSession({ auth: { signOut } } as never, go);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(go).toHaveBeenCalledWith(IDLE_LOGIN_URL);
    expect(IDLE_LOGIN_URL).toBe('/login?reason=idle');
  });
});

/** عميل وهمي: كل استعلام orders يرجع `rows` (أو count)، وpanel_session_alive يرجع `alive`. */
function ordersClient(rows: unknown[], alive: boolean, count = 0) {
  const chain: Record<string, unknown> = {};
  const result = { data: rows, error: null, count };
  for (const m of ['select', 'eq', 'gte', 'lt', 'or', 'order', 'limit', 'in', 'ilike']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return {
    from: vi.fn(() => chain),
    rpc: vi.fn(() => Promise.resolve({ data: alive, error: null })),
  };
}

describe('orders never show an empty list for an expired session (T23 F M4)', () => {
  const filters: OrdersFilters = { tab: 'pending', day: null, driverId: null, search: '' };

  it('empty first page + expired session → PanelSessionExpiredError (not an empty list)', async () => {
    const client = ordersClient([], false);
    await expect(
      fetchOrdersPage(client as never, filters, '2026-11-17', null),
    ).rejects.toBeInstanceOf(PanelSessionExpiredError);
    expect(client.rpc).toHaveBeenCalledWith('panel_session_alive');
  });

  it('empty first page + live session → a genuinely empty list', async () => {
    const page = await fetchOrdersPage(
      ordersClient([], true) as never,
      filters,
      '2026-11-17',
      null,
    );
    expect(page).toEqual({ rows: [], next: null });
  });

  it('rows present → no extra round trip', async () => {
    const client = ordersClient([{ id: 'a', created_at: '2026-11-17T10:00:00Z' }], false);
    await fetchOrdersPage(client as never, filters, '2026-11-17', null);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('all tab counts zero + expired session → PanelSessionExpiredError', async () => {
    await expect(
      fetchTabCounts(ordersClient([], false, 0) as never, '2026-11-17'),
    ).rejects.toBeInstanceOf(PanelSessionExpiredError);
    const counts = await fetchTabCounts(ordersClient([], true, 0) as never, '2026-11-17');
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});
