// T44: public/sw.js (JS خالص بلا استيراد) لازم يطابق routeForAdminNotification، ويعرض إشعاراً دائماً بلا بيانات زائدة.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { routeForAdminNotification } from './routing';

type Handler = (event: Record<string, unknown>) => void;
interface FakeWindow {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
}

function loadSw(origin = 'https://admin.test') {
  const handlers = new Map<string, Handler>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const windows: FakeWindow[] = [];
  const self = {
    location: { origin },
    addEventListener: (t: string, h: Handler) => handlers.set(t, h),
    skipWaiting: vi.fn(),
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
  };
  const file = path.resolve(__dirname, '../../../public/sw.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    self,
    Promise,
    JSON,
    String,
    RegExp,
    Object,
    Error,
  });
  const fire = async (type: string, event: Record<string, unknown> = {}) => {
    const pending: Promise<unknown>[] = [];
    const h = handlers.get(type);
    if (!h) throw new Error(`no ${type} handler`);
    h({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  };
  return { shown, opened, windows, fire };
}

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const CASES: unknown[] = [
  { type: 'new_order', order_id: ID },
  { type: 'new_order', order_id: ID.toUpperCase() },
  { type: 'customer_cancelled', order_id: ID },
  { type: 'new_order', order_id: 'x/../../evil' },
  { type: 'new_order' },
  { type: 'customer_cancelled', order_id: 42 },
  { type: 'driver_request', request_id: ID },
  { type: 'low_stock', product_id: ID },
  { type: 'ready', order_id: ID },
  { type: 'something_else', order_id: ID },
  { type: 5, order_id: ID },
  { order_id: ID },
  {},
  null,
  undefined,
  'text',
  [],
];

describe('routeForAdminNotification', () => {
  it('maps known types only, and only a UUID becomes part of the path', () => {
    expect(routeForAdminNotification({ type: 'new_order', order_id: ID })).toBe(
      `/orders?order=${ID}`,
    );
    expect(routeForAdminNotification({ type: 'customer_cancelled', order_id: ID })).toBe(
      `/orders?order=${ID}`,
    );
    expect(routeForAdminNotification({ type: 'new_order', order_id: 'x/../evil' })).toBe('/orders');
    expect(routeForAdminNotification({ type: 'driver_request' })).toBe('/driver-requests');
    expect(routeForAdminNotification({ type: 'low_stock' })).toBe('/stock');
    expect(routeForAdminNotification({ type: 'ready', order_id: ID })).toBeNull();
    expect(routeForAdminNotification(null)).toBeNull();
  });
});

describe('sw.js notificationclick == routeForAdminNotification', () => {
  it.each(CASES.map((d, i) => [i, d]))(
    'case %i: no window open ← openWindow(route)',
    async (_i, data) => {
      const sw = loadSw();
      const close = vi.fn();
      await sw.fire('notificationclick', { notification: { close, data } });
      expect(close).toHaveBeenCalled();
      expect(sw.opened).toEqual([routeForAdminNotification(data) ?? '/']);
    },
  );

  it('an open panel window is focused and navigated (no new window)', async () => {
    const sw = loadSw();
    const navigate = vi.fn().mockResolvedValue(null);
    const win: FakeWindow = { url: 'https://admin.test/stock', focus: vi.fn(), navigate };
    win.focus.mockResolvedValue(win);
    sw.windows.push(win);
    await sw.fire('notificationclick', {
      notification: { close: vi.fn(), data: { type: 'new_order', order_id: ID } },
    });
    expect(win.focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`/orders?order=${ID}`);
    expect(sw.opened).toEqual([]);
  });

  it('focus refused or no navigate ← a new window at the route (the click is not lost)', async () => {
    const sw = loadSw();
    sw.windows.push({
      url: 'https://admin.test/',
      focus: vi.fn().mockRejectedValue(new Error('no')),
    });
    await sw.fire('notificationclick', {
      notification: { close: vi.fn(), data: { type: 'driver_request' } },
    });
    const sw2 = loadSw();
    sw2.windows.push({ url: 'https://admin.test/', focus: vi.fn().mockResolvedValue(undefined) });
    await sw2.fire('notificationclick', {
      notification: { close: vi.fn(), data: { type: 'low_stock' } },
    });
    expect(sw.opened).toEqual(['/driver-requests']);
    expect(sw2.opened).toEqual(['/stock']);
  });

  it('a window from another origin is never focused', async () => {
    const sw = loadSw();
    const other: FakeWindow = { url: 'https://evil.test/', focus: vi.fn() };
    sw.windows.push(other);
    await sw.fire('notificationclick', { notification: { close: vi.fn(), data: {} } });
    expect(other.focus).not.toHaveBeenCalled();
    expect(sw.opened).toEqual(['/']);
  });
});

describe('sw.js push', () => {
  const push = (json: unknown) => ({ data: { json: () => json } });

  it('always shows a notification, RTL Arabic, with only type and order_id kept', async () => {
    const sw = loadSw();
    await sw.fire(
      'push',
      push({
        title: 'طلب جديد #12',
        body: 'المجموع 5000 د.ع',
        data: { type: 'new_order', order_id: ID, phone: '07701234567' },
      }),
    );
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe('طلب جديد #12');
    expect(sw.shown[0].options).toMatchObject({
      body: 'المجموع 5000 د.ع',
      lang: 'ar',
      dir: 'rtl',
      tag: `new_order:${ID}`,
      data: { type: 'new_order', order_id: ID },
    });
    expect(JSON.stringify(sw.shown[0].options.data)).not.toContain('0770');
  });

  it('an unreadable payload still shows a notification (iOS keeps the subscription)', async () => {
    const sw = loadSw();
    await sw.fire('push', {
      data: {
        json: () => {
          throw new Error('bad');
        },
      },
    });
    await sw.fire('push', {});
    expect(sw.shown.map((s) => s.title)).toEqual(['لوحة المخضر', 'لوحة المخضر']);
  });

  it('has no fetch handler (no offline cache, A9)', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8');
    expect(code).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
    expect(code).not.toMatch(/caches\./);
  });
});
