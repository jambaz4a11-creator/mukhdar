// T38: sw.js (JS خالص بلا استيراد) لازم يطابق routeForNotification بالتطبيق، ويعرض إشعاراً دائماً.
import fs from 'node:fs';
import path from 'node:path';
import { routeForNotification } from '../features/notifications/routing';
import { loadSw } from '../test-utils/loadSw';

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const CASES: unknown[] = [
  { order_id: ID, status: 'preparing' },
  { order_id: ID, status: 'ready' },
  { order_id: ID, status: 'out_for_delivery' },
  { order_id: ID, status: 'delivered' },
  { order_id: ID, type: 'cancelled', status: 'cancelled' },
  { order_id: ID },
  { order_id: 'not-a-uuid', status: 'ready' },
  { order_id: 42, status: 'ready' },
  { status: 'ready' },
  {},
  null,
  undefined,
  'text',
  [],
];

function windowAt(url: string) {
  return { url, focus: jest.fn().mockResolvedValue(undefined), postMessage: jest.fn() };
}

/** المسار الذي يفتحه التطبيق من كائن routeForNotification. */
function pathOf(data: unknown): string | null {
  const r = routeForNotification(data);
  if (!r) return null;
  return r.pathname === '/order/[id]/rate' ? `/order/${r.params.id}/rate` : `/order/${r.params.id}`;
}

describe('sw.js notificationclick == routeForNotification', () => {
  it.each(CASES.map((d, i) => [i, d]))('case %i', async (_i, data) => {
    const sw = loadSw('sw.js');
    const close = jest.fn();
    await sw.fire('notificationclick', { notification: { close, data } });
    expect(close).toHaveBeenCalled();
    expect(sw.opened).toEqual([pathOf(data) ?? '/']);
  });

  it('with an open window: focuses it and posts only the cleaned data', async () => {
    const sw = loadSw('sw.js');
    const win = windowAt('https://app.test/orders');
    sw.windows.push(win);
    await sw.fire('notificationclick', {
      notification: {
        close: jest.fn(),
        data: { status: 'ready', order_id: ID, address: 'بلوك A3', phone: '07701234567' },
      },
    });
    expect(win.focus).toHaveBeenCalled();
    expect(win.postMessage).toHaveBeenCalledWith({
      type: 'mukhdar:notification-click',
      data: { status: 'ready', order_id: ID },
    });
    expect(sw.opened).toEqual([]);
  });

  it('ignores windows of another origin', async () => {
    const sw = loadSw('sw.js');
    sw.windows.push(windowAt('https://evil.test/'));
    await sw.fire('notificationclick', {
      notification: { close: jest.fn(), data: { order_id: ID, status: 'ready' } },
    });
    expect(sw.opened).toEqual([`/order/${ID}`]);
  });
});

describe('sw.js push', () => {
  const evt = (json: unknown) => ({ data: { json: () => json } });

  it('always shows a notification with Arabic RTL options and a per-order tag', async () => {
    const sw = loadSw('sw.js');
    await sw.fire(
      'push',
      evt({ title: 'طلبك جاهز', body: 'طلبك #5 جاهز', data: { status: 'ready', order_id: ID } }),
    );
    expect(sw.shown).toHaveLength(1);
    const { title, options } = sw.shown[0] ?? { title: '', options: {} };
    expect(title).toBe('طلبك جاهز');
    expect(options).toMatchObject({ lang: 'ar', dir: 'rtl', tag: `ready:${ID}` });
    expect(options.data).toEqual({ status: 'ready', order_id: ID });
  });

  it.each([
    [
      'garbage',
      () => {
        throw new Error('bad json');
      },
    ],
    ['null body', () => null],
    ['wrong types', () => ({ title: 5, body: {}, data: 'x' })],
  ])('still shows a notification for %s payload', async (_n, json) => {
    const sw = loadSw('sw.js');
    await sw.fire('push', { data: { json } });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]?.title).toBeTruthy();
  });

  it('shows one even when the push has no data at all', async () => {
    const sw = loadSw('sw.js');
    await sw.fire('push', {});
    expect(sw.shown).toHaveLength(1);
  });

  it('forwards only order_id/status/type to the notification data and the open windows', async () => {
    const sw = loadSw('sw.js');
    const win = windowAt('https://app.test/');
    sw.windows.push(win);
    await sw.fire(
      'push',
      evt({
        title: 't',
        body: 'b',
        data: { status: 'ready', order_id: ID, phone: '0770', floor: 3 },
      }),
    );
    expect(sw.shown[0]?.options.data).toEqual({ status: 'ready', order_id: ID });
    expect(win.postMessage).toHaveBeenCalledWith({
      type: 'mukhdar:notification-received',
      data: { status: 'ready', order_id: ID },
    });
  });
});

describe('sw.js lifecycle and scope', () => {
  it('claims clients on activate', async () => {
    const sw = loadSw('sw.js');
    await sw.fire('activate');
    expect(sw.claimed()).toBe(true);
  });

  it('pushsubscriptionchange only notifies windows (no RPC from the worker)', async () => {
    const sw = loadSw('sw.js');
    const win = windowAt('https://app.test/');
    sw.windows.push(win);
    await sw.fire('pushsubscriptionchange');
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'mukhdar:subscription-change' });
  });

  it('has no fetch handler, no cache, no network and no logging (A2, privacy)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
    expect(src).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
    expect(src).not.toMatch(/\bcaches\b|\bfetch\(|XMLHttpRequest|importScripts|console\./);
  });
});
