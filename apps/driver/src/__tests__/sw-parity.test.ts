// T38: sw.js (JS خالص بلا استيراد) لازم يطابق routeForNotification بالتطبيق، ويعرض إشعاراً دائماً.
import fs from 'node:fs';
import path from 'node:path';
import { routeForNotification } from '../features/notifications/routing';
import { loadSw } from '../test-utils/loadSw';

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const CASES: unknown[] = [
  { type: 'new_order', order_id: ID },
  { type: 'ready', order_id: ID },
  { type: 'assigned', order_id: ID },
  { type: 'ready', order_id: 'not-a-uuid' },
  { type: 'ready' },
  { type: 'ready', order_id: 42 },
  { type: 'unassigned', order_id: ID },
  { type: 'cancelled', order_id: ID },
  { type: 'driver_request_approved' },
  { type: 'cash_handover' },
  { type: 'cash_handover', handover_id: ID },
  { type: 'something_else', order_id: ID },
  { type: 5, order_id: ID },
  { order_id: ID },
  {},
  null,
  undefined,
  'text',
  [],
];

const CLICK_DATA = { type: 'ready', order_id: ID };
const CLICK_PATH = `/order/${ID}`;

function windowAt(url: string) {
  return { url, focus: jest.fn().mockResolvedValue(undefined), postMessage: jest.fn() };
}

describe('sw.js notificationclick == routeForNotification', () => {
  it.each(CASES.map((d, i) => [i, d]))('case %i', async (_i, data) => {
    const sw = loadSw('sw.js');
    const close = jest.fn();
    await sw.fire('notificationclick', { notification: { close, data } });
    expect(close).toHaveBeenCalled();
    // لا نافذة مفتوحة ← openWindow بالمسار نفسه ('/' عند بيانات غير صالحة: لا مسار مزوَّر)
    expect(sw.opened).toEqual([routeForNotification(data) ?? '/']);
  });

  it('with an open window: focuses it and posts only the cleaned data', async () => {
    const sw = loadSw('sw.js');
    const win = windowAt('https://app.test/');
    sw.windows.push(win);
    await sw.fire('notificationclick', {
      notification: {
        close: jest.fn(),
        data: { type: 'ready', order_id: ID, phone: '07701234567' },
      },
    });
    expect(win.focus).toHaveBeenCalled();
    expect(win.postMessage).toHaveBeenCalledWith({
      type: 'mukhdar:notification-click',
      data: { type: 'ready', order_id: ID },
    });
    expect(sw.opened).toEqual([]);
  });

  it('R3 L3: focus refused -> the click still opens the route in a window', async () => {
    const sw = loadSw('sw.js');
    const win = windowAt('https://app.test/');
    win.focus.mockRejectedValue(new Error('not allowed'));
    sw.windows.push(win);
    await sw.fire('notificationclick', {
      notification: { close: jest.fn(), data: CLICK_DATA },
    });
    expect(win.postMessage).not.toHaveBeenCalled();
    expect(sw.opened).toEqual([CLICK_PATH]);
  });

  it('ignores windows of another origin', async () => {
    const sw = loadSw('sw.js');
    sw.windows.push(windowAt('https://evil.test/'));
    await sw.fire('notificationclick', {
      notification: { close: jest.fn(), data: { type: 'ready', order_id: ID } },
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
      evt({
        title: 'طلب جاهز #5',
        body: 'بلوك A3 - بناية 12',
        data: { type: 'ready', order_id: ID },
      }),
    );
    expect(sw.shown).toHaveLength(1);
    const { title, options } = sw.shown[0] ?? { title: '', options: {} };
    expect(title).toBe('طلب جاهز #5');
    expect(options).toMatchObject({
      body: 'بلوك A3 - بناية 12',
      lang: 'ar',
      dir: 'rtl',
      tag: `ready:${ID}`,
    });
    expect(options.data).toEqual({ type: 'ready', order_id: ID });
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

  it('forwards only order_id/type to the notification data and the open windows', async () => {
    const sw = loadSw('sw.js');
    const win = windowAt('https://app.test/');
    sw.windows.push(win);
    await sw.fire(
      'push',
      evt({
        title: 't',
        body: 'b',
        data: { type: 'ready', order_id: ID, phone: '0770', floor: 3 },
      }),
    );
    expect(sw.shown[0]?.options.data).toEqual({ type: 'ready', order_id: ID });
    expect(win.postMessage).toHaveBeenCalledWith({
      type: 'mukhdar:notification-received',
      data: { type: 'ready', order_id: ID },
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
