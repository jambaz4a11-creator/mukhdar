// تتبع الطلبات والتقييم والإشعارات (T14): التوجيه من بيانات الإشعار، keyset، "اطلب مرة أخرى"، شاشة الطلب
// (الإلغاء في pending فقط، التقييم بعد التسليم إن لم يُقيَّم، الخط الزمني، Realtime والإلغاء عند المغادرة أو
// الحالة النهائية)، طلباتي، التقييم، وتسجيل/حذف رمز الجهاز. Supabase وقناة Realtime مزيفان، بلا شبكة.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ERROR_MESSAGES,
  formatAddress,
  formatIQD,
  STATUS_LABELS,
  type OrderStatus,
} from '@mukhdar/shared';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../test-utils/queryClient';
import { refocus } from '../test-utils/focus';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { ReactElement } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import OrdersScreen from '../app/(tabs)/orders';
import OrderScreen from '../app/order/[id]';
import RateScreen from '../app/order/[id]/rate';
import { useAuth } from '../features/auth/store';
import { useCart } from '../features/cart/store';
import {
  registerPushToken,
  unregisterPushToken,
  PUSH_TOKEN_KEY,
} from '../features/notifications/push';
import { routeForNotification } from '../features/notifications/routing';
import {
  fetchOrdersPage,
  nextOrdersCursor,
  type OrderDetail,
  type OrderListItem,
  ORDERS_PAGE_SIZE,
  planReorder,
} from '../features/orders/api';
import { formatOrderDate, formatTime } from '../features/orders/format';
import { fallbackInterval, ORDER_FALLBACK_REFETCH_MS } from '../features/orders/hooks';
import { ar } from '../i18n/ar';
import {
  type Call,
  createFakeSupabase,
  makeProduct,
  opArgs,
  type Result,
} from '../test-utils/fakeSupabase';

// ------------------------------------------------------------------ mocks
let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  canGoBack: jest.fn(() => true),
};
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockRouter.push(...a),
    replace: (...a: unknown[]) => mockRouter.replace(...a),
    back: (...a: unknown[]) => mockRouter.back(...a),
    navigate: (...a: unknown[]) => mockRouter.navigate(...a),
    canGoBack: () => mockRouter.canGoBack(),
  },
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/orders',
  useFocusEffect: (cb: () => void) =>
    (
      jest.requireActual('../test-utils/focus') as typeof import('../test-utils/focus')
    ).mockFocusEffect(cb),
}));
// expo-constants الحقيقي (expo-asset يحتاجه) مع حقول قابلة للتغيير لاختبار شروط الإشعارات
jest.mock('expo-constants', () => {
  const actual = jest.requireActual<{ default: object }>('expo-constants');
  return {
    ...actual,
    __esModule: true,
    default: {
      ...actual.default,
      executionEnvironment: 'storeClient',
      expoConfig: { extra: {} },
      easConfig: null,
    },
  };
});
const mockConstants = jest.requireMock<{
  default: { executionEnvironment: string; expoConfig: { extra: Record<string, unknown> } };
}>('expo-constants').default;

const SESSION = { user: { id: 'u1', phone: '9647701234567' }, access_token: 't' };
const ORDER_ID = '0b9a7c1e-2f3d-4a5b-8c6d-7e8f9a0b1c2d';

// ------------------------------------------------------------------ بيانات مزيفة
function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ORDER_ID,
    order_number: 1042,
    status: 'pending',
    subtotal_iqd: 4000,
    delivery_fee_iqd: 1000,
    total_iqd: 5000,
    note: null,
    address_snapshot: {
      address_id: 'a1',
      sector: 'قطاع A',
      subsection: 'A3',
      building: '45',
      apartment: '12',
      note: 'الطابق الثالث',
    },
    created_at: '2026-11-15T07:24:00Z',
    preparing_at: null,
    ready_at: null,
    out_for_delivery_at: null,
    delivered_at: null,
    cancelled_at: null,
    cancel_reason: null,
    items: [
      {
        product_id: 't',
        name_snapshot: 'طماطة',
        unit_snapshot: 'نص كيلو',
        price_snapshot_iqd: 750,
        qty: 2,
        line_total_iqd: 1500,
      },
      {
        product_id: 'm',
        name_snapshot: 'نعناع',
        unit_snapshot: 'باقة',
        price_snapshot_iqd: 250,
        qty: 3,
        line_total_iqd: 750,
      },
    ],
    rating: null,
    ...overrides,
  };
}

/** الصف كما يرجعه PostgREST (علاقات order_items و ratings). */
function rawDetail(o: OrderDetail) {
  const { items, rating, ...rest } = o;
  return { ...rest, order_items: items, ratings: rating };
}

function listItem(overrides: Partial<OrderListItem> & { id: string }): OrderListItem {
  return {
    order_number: 1000,
    status: 'delivered',
    total_iqd: 3000,
    created_at: '2026-11-14T10:00:00Z',
    items: [{ product_id: 't', name_snapshot: 'طماطة', qty: 2 }],
    rating: null,
    ...overrides,
  };
}

// قناة Realtime مزيفة: تسجل الفلتر، وتسمح بإرسال حالة الاشتراك وتحديثات الصف
interface FakeChannel {
  name: string;
  filter: Record<string, unknown> | null;
  onUpdate: ((payload: { new: unknown }) => void) | null;
  onStatus: ((status: string) => void) | null;
  removed: boolean;
}

interface Options {
  detail?: OrderDetail | null;
  list?: OrderListItem[];
  products?: ReturnType<typeof makeProduct>[];
  rpc?: (fn: string, args: unknown) => Result;
}

function setup(opts: Options = {}) {
  let detail = opts.detail === undefined ? order() : opts.detail;
  const fake = createFakeSupabase((call: Call): Result => {
    if (call.table === 'orders') {
      if (opArgs(call, 'maybeSingle')) {
        return { data: detail ? rawDetail(detail) : null, error: null };
      }
      const rows = (opts.list ?? []).map(({ items, rating, ...o }) => ({
        ...o,
        order_items: items,
        ratings: rating,
      }));
      return { data: rows, error: null };
    }
    if (call.table === 'products') {
      const ids = (opArgs(call, 'in')?.[1] as string[] | undefined) ?? [];
      return { data: (opts.products ?? []).filter((p) => ids.includes(p.id)), error: null };
    }
    return { data: null, error: null };
  });
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const channels: FakeChannel[] = [];
  const client = {
    ...fake.client,
    rpc(fn: string, args?: unknown) {
      rpcCalls.push({ fn, args });
      return Promise.resolve().then(() => opts.rpc?.(fn, args) ?? { data: null, error: null });
    },
    channel(name: string) {
      const ch: FakeChannel = {
        name,
        filter: null,
        onUpdate: null,
        onStatus: null,
        removed: false,
      };
      channels.push(ch);
      const api = {
        on(_type: string, filter: Record<string, unknown>, cb: FakeChannel['onUpdate']) {
          ch.filter = filter;
          ch.onUpdate = cb;
          return api;
        },
        subscribe(cb: FakeChannel['onStatus']) {
          ch.onStatus = cb;
          return ch;
        },
      };
      return api;
    },
    removeChannel(ch: FakeChannel) {
      ch.removed = true;
      return Promise.resolve('ok');
    },
  };
  mockClient = client;
  return {
    calls: fake.calls,
    rpcCalls,
    channels,
    setDetail: (d: OrderDetail) => {
      detail = d;
    },
  };
}

async function renderUi(ui: ReactElement) {
  const client = createTestQueryClient();
  return await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>,
  );
}

/** يضغط زر Alert بالنص المعطى (Alert.alert مُتجسَّس عليه). */
function pressAlertButton(spy: jest.SpyInstance, text: string) {
  const buttons = (spy.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  const button = buttons.find((b) => b.text === text);
  if (!button) throw new Error(`no alert button "${text}"`);
  button.onPress?.();
}

let alertSpy: jest.SpyInstance;

beforeEach(async () => {
  mockParams = { id: ORDER_ID };
  Object.values(mockRouter).forEach((f) => f.mockClear());
  mockRouter.canGoBack.mockReturnValue(true);
  useAuth.setState({ session: SESSION as never, ready: true });
  useCart.setState({ items: {}, flags: {} });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await AsyncStorage.clear();
});

afterEach(() => {
  alertSpy.mockRestore();
});

// ------------------------------------------------------------------ وحدات
describe('notification routing', () => {
  it('delivered opens the rating screen; every other status opens the order', () => {
    expect(routeForNotification({ order_id: ORDER_ID, status: 'delivered' })).toEqual({
      pathname: '/order/[id]/rate',
      params: { id: ORDER_ID },
    });
    for (const status of ['preparing', 'ready', 'out_for_delivery', 'cancelled', undefined]) {
      expect(routeForNotification({ order_id: ORDER_ID, status })).toEqual({
        pathname: '/order/[id]',
        params: { id: ORDER_ID },
      });
    }
  });

  it('ignores data without a valid order id', () => {
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification('x')).toBeNull();
    expect(routeForNotification({ status: 'ready' })).toBeNull();
    expect(routeForNotification({ order_id: 42 })).toBeNull();
    expect(routeForNotification({ order_id: '../auth/sign-in' })).toBeNull();
  });
});

describe('fallback refetch', () => {
  it('every 30 s only while the order is open, not final and the channel is down', () => {
    expect(fallbackInterval('pending', false)).toBe(ORDER_FALLBACK_REFETCH_MS);
    expect(ORDER_FALLBACK_REFETCH_MS).toBe(30_000);
    expect(fallbackInterval('out_for_delivery', true)).toBe(false);
    expect(fallbackInterval('delivered', false)).toBe(false);
    expect(fallbackInterval('cancelled', false)).toBe(false);
    expect(fallbackInterval(undefined, false)).toBe(false);
  });
});

describe('order dates (Baghdad time)', () => {
  it('formats time and today / yesterday / date', () => {
    const now = new Date('2026-11-15T12:00:00Z'); // 3:00 م ببغداد
    expect(formatTime('2026-11-15T07:24:00Z')).toBe('10:24 ص');
    expect(formatTime('2026-11-15T09:05:00Z')).toBe('12:05 م');
    expect(formatTime('2026-11-14T21:30:00Z')).toBe('12:30 ص'); // منتصف الليل ببغداد
    expect(formatOrderDate('2026-11-15T07:24:00Z', now)).toBe('اليوم، 10:24 ص');
    // 22:30 UTC يوم 14 = 1:30 ص يوم 15 ببغداد ← اليوم
    expect(formatOrderDate('2026-11-14T22:30:00Z', now)).toBe('اليوم، 1:30 ص');
    expect(formatOrderDate('2026-11-14T10:00:00Z', now)).toBe('أمس، 1:00 م');
    expect(formatOrderDate('2026-11-02T10:00:00Z', now)).toBe('2/11/2026، 1:00 م');
  });
});

describe('orders keyset pagination', () => {
  it('first page: own orders, newest first (created_at, id desc), 20 rows', async () => {
    const { calls } = setup({ list: [] });
    await fetchOrdersPage(mockClient as never, 'u1', null);
    const call = calls[0] as Call;
    expect(opArgs(call, 'eq')).toEqual(['customer_id', 'u1']);
    expect(call.ops.filter(([n]) => n === 'order').map(([, a]) => a)).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(opArgs(call, 'limit')).toEqual([ORDERS_PAGE_SIZE]);
    expect(ORDERS_PAGE_SIZE).toBe(20);
    expect(opArgs(call, 'or')).toBeUndefined();
  });

  it('next page starts strictly after the last (created_at, id)', async () => {
    const { calls } = setup({ list: [] });
    const ts = '2026-11-14T10:00:00.123456+00:00';
    await fetchOrdersPage(mockClient as never, 'u1', { created_at: ts, id: 'o9' });
    expect(opArgs(calls[0] as Call, 'or')).toEqual([
      `created_at.lt."${ts}",and(created_at.eq."${ts}",id.lt.o9)`,
    ]);
  });

  it('a full page has a cursor; a short page is the end', () => {
    const page = Array.from({ length: 20 }, (_, i) =>
      listItem({ id: `o${i}`, created_at: `2026-11-${10 + (i % 5)}T10:00:00Z` }),
    );
    expect(nextOrdersCursor(page)).toEqual({ id: 'o19', created_at: page[19]?.created_at });
    expect(nextOrdersCursor(page.slice(0, 19))).toBeUndefined();
  });
});

describe('order again plan', () => {
  it('adds available items only, merges duplicates, caps at 99 and names the skipped ones', () => {
    const current = new Map([
      ['t', makeProduct({ id: 't', name: 'طماطة' })],
      ['c', makeProduct({ id: 'c', name: 'خيار', in_stock: false })],
    ]);
    const plan = planReorder(
      [
        { product_id: 't', name_snapshot: 'طماطة', qty: 60 },
        { product_id: 't', name_snapshot: 'طماطة', qty: 60 },
        { product_id: 'c', name_snapshot: 'خيار', qty: 1 },
        { product_id: 'gone', name_snapshot: 'رمان', qty: 1 }, // موقوف: RLS لا يرجعه
        { product_id: null, name_snapshot: 'منتج محذوف', qty: 1 },
      ],
      current,
    );
    expect(plan.add).toEqual([{ id: 't', qty: 99 }]);
    expect(plan.skipped).toEqual(['خيار', 'رمان', 'منتج محذوف']);
  });
});

// ------------------------------------------------------------------ شاشة الطلب
describe('order screen', () => {
  it('offline with nothing cached: says so instead of spinning, loads when back online (review S4)', async () => {
    setup();
    onlineManager.setOnline(false);
    await renderUi(<OrderScreen />);
    expect(await screen.findByTestId('offline-state')).toBeTruthy();
    expect(screen.getByText(ar.offline.title)).toBeTruthy();
    await act(async () => onlineManager.setOnline(true));
    expect(await screen.findByText(ar.order.title(1042))).toBeTruthy();
    expect(screen.queryByTestId('offline-state')).toBeNull();
  });

  it('shows backend totals, items with formatQuantity, address via formatAddress', async () => {
    setup();
    await renderUi(<OrderScreen />);
    expect(await screen.findByText(ar.order.title(1042))).toBeTruthy();
    expect(screen.getByText('طماطة · 1 كيلو')).toBeTruthy();
    expect(screen.getByText('نعناع · 3 باقة')).toBeTruthy();
    expect(screen.getByTestId('order-total')).toHaveTextContent(formatIQD(5000));
    expect(screen.getByTestId('order-address')).toHaveTextContent(
      formatAddress(order().address_snapshot),
    );
    expect(screen.getByText(ar.order.cashDue(formatIQD(5000)))).toBeTruthy();
  });

  it('cancel shows only while pending', async () => {
    const statuses: OrderStatus[] = [
      'preparing',
      'ready',
      'out_for_delivery',
      'delivered',
      'cancelled',
    ];
    setup({ detail: order({ status: 'pending' }) });
    const first = await renderUi(<OrderScreen />);
    expect(await screen.findByTestId('order-cancel')).toBeTruthy();
    await first.unmount();
    for (const status of statuses) {
      setup({ detail: order({ status }) });
      const r = await renderUi(<OrderScreen />);
      expect(await r.findByTestId('order-hero')).toBeTruthy();
      expect(r.queryByTestId('order-cancel')).toBeNull();
      await r.unmount();
    }
  });

  it('cancel asks for confirmation, then calls set_order_status and refreshes', async () => {
    const env = setup();
    await renderUi(<OrderScreen />);
    await fireEvent.press(await screen.findByTestId('order-cancel'));
    expect(alertSpy).toHaveBeenCalledWith(
      ar.order.cancelTitle,
      ar.order.cancelBody,
      expect.any(Array),
    );
    expect(env.rpcCalls).toHaveLength(0); // لا شيء قبل التأكيد

    env.setDetail(order({ status: 'cancelled', cancelled_at: '2026-11-15T07:30:00Z' }));
    await act(async () => pressAlertButton(alertSpy, ar.order.cancelConfirm));
    await waitFor(() => expect(screen.queryByTestId('order-cancel')).toBeNull());
    expect(env.rpcCalls).toEqual([
      { fn: 'set_order_status', args: { p_order_id: ORDER_ID, p_status: 'cancelled' } },
    ]);
    expect(
      within(screen.getByTestId('order-hero')).getByText(ar.order.hero.cancelled),
    ).toBeTruthy();
  });

  it('a cancel rejected by the backend shows the message and the real status', async () => {
    const env = setup({
      rpc: () => ({ data: null, error: { message: 'INVALID_TRANSITION', details: null } }),
    });
    await renderUi(<OrderScreen />);
    await fireEvent.press(await screen.findByTestId('order-cancel'));
    env.setDetail(order({ status: 'preparing', preparing_at: '2026-11-15T07:31:00Z' }));
    await act(async () => pressAlertButton(alertSpy, ar.order.cancelConfirm));
    expect(await screen.findByText(ERROR_MESSAGES.INVALID_TRANSITION)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('order-cancel')).toBeNull());
  });

  it('rate button only after delivery and only if not rated', async () => {
    setup({ detail: order({ status: 'out_for_delivery' }) });
    const a = await renderUi(<OrderScreen />);
    expect(await a.findByTestId('order-hero')).toBeTruthy();
    expect(a.queryByTestId('order-rate')).toBeNull();
    await a.unmount();

    setup({ detail: order({ status: 'delivered', rating: { stars: 4 } }) });
    const b = await renderUi(<OrderScreen />);
    expect(await b.findByTestId('order-rated')).toHaveTextContent(ar.order.rated(4));
    expect(b.queryByTestId('order-rate')).toBeNull();
    await b.unmount();

    setup({ detail: order({ status: 'delivered', delivered_at: '2026-11-15T08:00:00Z' }) });
    const c = await renderUi(<OrderScreen />);
    await fireEvent.press(await c.findByTestId('order-rate'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/order/[id]/rate',
      params: { id: ORDER_ID },
    });
  });

  it('timeline: done steps, current step, and cancelled with reason', async () => {
    setup({
      detail: order({
        status: 'out_for_delivery',
        preparing_at: '2026-11-15T07:31:00Z',
        ready_at: '2026-11-15T07:44:00Z',
        out_for_delivery_at: '2026-11-15T07:48:00Z',
      }),
    });
    const a = await renderUi(<OrderScreen />);
    expect(await a.findByTestId('step-pending-done')).toBeTruthy();
    expect(a.getByTestId('step-ready-done')).toBeTruthy();
    expect(a.getByTestId('step-out_for_delivery-current')).toBeTruthy();
    expect(a.getByTestId('step-delivered-todo')).toBeTruthy();
    expect(a.getByText('10:48 ص')).toBeTruthy();
    await a.unmount();

    setup({
      detail: order({
        status: 'cancelled',
        preparing_at: '2026-11-15T07:31:00Z',
        cancelled_at: '2026-11-15T07:40:00Z',
        cancel_reason: 'نفد المخزون',
      }),
    });
    const b = await renderUi(<OrderScreen />);
    expect(await b.findByTestId('step-cancelled-cancelled')).toBeTruthy();
    expect(b.getByTestId('step-preparing-done')).toBeTruthy();
    expect(b.queryByTestId('step-ready-done')).toBeNull();
    expect(b.getByText(ar.order.cancelReason('نفد المخزون'))).toBeTruthy();
  });

  it('realtime: subscribes with id=eq.<id>, applies updates, unsubscribes on a final status', async () => {
    const env = setup();
    await renderUi(<OrderScreen />);
    expect(await screen.findByTestId('order-cancel')).toBeTruthy();
    await waitFor(() => expect(env.channels).toHaveLength(1));
    const ch = env.channels[0] as FakeChannel;
    expect(ch.filter).toEqual({
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: `id=eq.${ORDER_ID}`,
    });
    await act(async () => ch.onStatus?.('SUBSCRIBED'));

    await act(async () =>
      ch.onUpdate?.({
        new: { id: ORDER_ID, status: 'preparing', preparing_at: '2026-11-15T07:31:00Z' },
      }),
    );
    expect(await screen.findByText(ar.order.hero.preparing)).toBeTruthy();
    expect(screen.queryByTestId('order-cancel')).toBeNull();
    expect(ch.removed).toBe(false);

    await act(async () =>
      ch.onUpdate?.({
        new: { id: ORDER_ID, status: 'delivered', delivered_at: '2026-11-15T08:00:00Z' },
      }),
    );
    expect(await screen.findByText(ar.order.hero.delivered)).toBeTruthy();
    await waitFor(() => expect(ch.removed).toBe(true));
    expect(env.channels).toHaveLength(1); // لا اشتراك جديد بعد الحالة النهائية
  });

  it('realtime: unsubscribes when leaving the screen', async () => {
    const env = setup();
    const r = await renderUi(<OrderScreen />);
    await waitFor(() => expect(env.channels).toHaveLength(1));
    await r.unmount();
    expect((env.channels[0] as FakeChannel).removed).toBe(true);
  });

  it('a final order never subscribes', async () => {
    const env = setup({ detail: order({ status: 'delivered' }) });
    await renderUi(<OrderScreen />);
    expect(await screen.findByTestId('order-hero')).toBeTruthy();
    expect(env.channels).toHaveLength(0);
  });

  it('unknown order shows not found', async () => {
    setup({ detail: null });
    await renderUi(<OrderScreen />);
    expect(await screen.findByText(ar.order.notFound)).toBeTruthy();
  });
});

// ------------------------------------------------------------------ طلباتي
describe('my orders', () => {
  const LIST = [
    listItem({ id: 'o3', order_number: 1043, status: 'pending', total_iqd: 5000 }),
    listItem({
      id: 'o2',
      order_number: 1042,
      status: 'delivered',
      items: [
        { product_id: 't', name_snapshot: 'طماطة', qty: 2 },
        { product_id: 'c', name_snapshot: 'خيار', qty: 1 },
        { product_id: 'gone', name_snapshot: 'رمان', qty: 1 },
      ],
    }),
    listItem({ id: 'o1', order_number: 1041, status: 'delivered', rating: { stars: 5 } }),
  ];

  it('refetches every time the tab regains focus (review S3)', async () => {
    const env = setup({ list: LIST });
    await renderUi(<OrdersScreen />);
    await screen.findByText(ar.order.title(1043));
    const fetches = () => env.calls.filter((c) => c.table === 'orders').length;
    const before = fetches();
    expect(before).toBe(1);
    await act(async () => refocus());
    await waitFor(() => expect(fetches()).toBe(before + 1));
  });

  it('offline with nothing cached: offline state, not an endless spinner (review S4)', async () => {
    setup({ list: LIST });
    onlineManager.setOnline(false);
    await renderUi(<OrdersScreen />);
    expect(await screen.findByTestId('offline-state')).toBeTruthy();
    await act(async () => onlineManager.setOnline(true));
    expect(await screen.findByText(ar.order.title(1043))).toBeTruthy();
  });

  it('cards with number, status badge from shared and total; actions per status', async () => {
    setup({ list: LIST });
    await renderUi(<OrdersScreen />);
    expect(await screen.findByText(ar.order.title(1043))).toBeTruthy();
    expect(screen.getByTestId('order-status-o3')).toHaveTextContent(STATUS_LABELS.pending);
    expect(screen.getByTestId('order-status-o2')).toHaveTextContent(STATUS_LABELS.delivered);
    expect(screen.getByText(formatIQD(5000))).toBeTruthy();
    // جارٍ: لا "اطلب مرة أخرى" ولا تقييم
    expect(screen.queryByTestId('order-reorder-o3')).toBeNull();
    expect(screen.queryByTestId('order-rate-o3')).toBeNull();
    // مُسلَّم وغير مُقيَّم: الاثنان. مُسلَّم ومُقيَّم: إعادة الطلب فقط
    expect(screen.getByTestId('order-rate-o2')).toBeTruthy();
    expect(screen.getByTestId('order-reorder-o1')).toBeTruthy();
    expect(screen.queryByTestId('order-rate-o1')).toBeNull();

    await fireEvent.press(screen.getByText(ar.order.title(1043)));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/order/[id]',
      params: { id: 'o3' },
    });
  });

  it('order again adds available items only and says what was skipped', async () => {
    const env = setup({
      list: LIST,
      products: [
        makeProduct({ id: 't', name: 'طماطة' }),
        makeProduct({ id: 'c', name: 'خيار', in_stock: false }),
      ],
    });
    useCart.setState({ items: { t: 1 }, flags: {} });
    await renderUi(<OrdersScreen />);
    await fireEvent.press(await screen.findByTestId('order-reorder-o2'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const productsCall = env.calls.find((c) => c.table === 'products') as Call;
    expect((opArgs(productsCall, 'in')?.[1] as string[]).sort()).toEqual(['c', 'gone', 't']);
    expect(useCart.getState().items).toEqual({ t: 3 }); // دُمج مع الموجود
    const [title, message] = alertSpy.mock.calls[0] as [string, string];
    expect(title).toBe(ar.orders.reorderTitle);
    expect(message).toContain(ar.orders.reorderAdded(1));
    expect(message).toContain(ar.orders.reorderSkipped('خيار، رمان'));
    pressAlertButton(alertSpy, ar.orders.viewCart);
    expect(mockRouter.navigate).toHaveBeenCalledWith('/cart');
  });

  it('order again with nothing available adds nothing and says so', async () => {
    setup({ list: LIST, products: [] });
    await renderUi(<OrdersScreen />);
    await fireEvent.press(await screen.findByTestId('order-reorder-o2'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(useCart.getState().items).toEqual({});
    expect(alertSpy.mock.calls[0]?.[1]).toBe(ar.orders.reorderNone);
  });

  it('empty list', async () => {
    setup({ list: [] });
    await renderUi(<OrdersScreen />);
    expect(await screen.findByTestId('orders-empty')).toBeTruthy();
  });
});

// ------------------------------------------------------------------ التقييم
describe('rate screen', () => {
  it('stars + comment → rate_order once, then thanks', async () => {
    const env = setup({ detail: order({ status: 'delivered' }) });
    await renderUi(<RateScreen />);
    expect(await screen.findByText(ar.rate.title(1042))).toBeTruthy();
    expect(screen.getByTestId('rate-submit').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByTestId('rate-star-4'));
    expect(screen.getByText(ar.rate.captions[4])).toBeTruthy();
    expect(screen.getByTestId('rate-star-4').props.accessibilityState).toEqual({ checked: true });
    await fireEvent.changeText(screen.getByTestId('rate-comment'), '  ممتاز وسريع  ');
    expect(screen.getByTestId('rate-comment').props.maxLength).toBe(500);
    await fireEvent.press(screen.getByTestId('rate-submit'));

    expect(await screen.findByTestId('rate-thanks')).toBeTruthy();
    expect(env.rpcCalls).toEqual([
      {
        fn: 'rate_order',
        args: { p_order_id: ORDER_ID, p_stars: 4, p_comment: 'ممتاز وسريع' },
      },
    ]);
    expect(screen.queryByTestId('rate-submit')).toBeNull();
  });

  it('empty comment is not sent', async () => {
    const env = setup({ detail: order({ status: 'delivered' }) });
    await renderUi(<RateScreen />);
    await fireEvent.press(await screen.findByTestId('rate-star-5'));
    await fireEvent.press(screen.getByTestId('rate-submit'));
    await screen.findByTestId('rate-thanks');
    expect(env.rpcCalls[0]?.args).toEqual({ p_order_id: ORDER_ID, p_stars: 5 });
  });

  it('ALREADY_RATED from the backend is treated as done', async () => {
    setup({
      detail: order({ status: 'delivered' }),
      rpc: () => ({ data: null, error: { message: 'ALREADY_RATED', details: null } }),
    });
    await renderUi(<RateScreen />);
    await fireEvent.press(await screen.findByTestId('rate-star-3'));
    await fireEvent.press(screen.getByTestId('rate-submit'));
    expect(await screen.findByTestId('rate-thanks')).toBeTruthy();
  });

  it('other errors show a message and allow retry', async () => {
    setup({
      detail: order({ status: 'delivered' }),
      rpc: () => ({ data: null, error: { message: 'ORDER_NOT_RATEABLE', details: null } }),
    });
    await renderUi(<RateScreen />);
    await fireEvent.press(await screen.findByTestId('rate-star-2'));
    await fireEvent.press(screen.getByTestId('rate-submit'));
    expect(await screen.findByText(ERROR_MESSAGES.ORDER_NOT_RATEABLE)).toBeTruthy();
    expect(screen.getByTestId('rate-submit')).toBeTruthy();
  });

  it('an already rated or undelivered order cannot be rated', async () => {
    const env = setup({ detail: order({ status: 'delivered', rating: { stars: 5 } }) });
    const a = await renderUi(<RateScreen />);
    expect(await a.findByTestId('rate-blocked')).toHaveTextContent(ar.rate.already);
    expect(a.queryByTestId('rate-submit')).toBeNull();
    await a.unmount();

    setup({ detail: order({ status: 'out_for_delivery' }) });
    const b = await renderUi(<RateScreen />);
    expect(await b.findByTestId('rate-blocked')).toHaveTextContent(ar.rate.notDelivered);
    expect(env.rpcCalls).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ رمز الجهاز
describe('push token', () => {
  const Device = jest.requireMock<{ isDevice: boolean }>('expo-device');

  afterEach(() => {
    Device.isDevice = false;
    mockConstants.executionEnvironment = 'storeClient';
    mockConstants.expoConfig.extra = {};
  });

  it('Expo Go / simulator / no projectId: skipped without asking for permission', async () => {
    const env = setup();
    expect(await registerPushToken(mockClient as never, { ask: true })).toBe('unsupported');
    Device.isDevice = true; // جهاز حقيقي لكن Expo Go
    expect(await registerPushToken(mockClient as never, { ask: true })).toBe('unsupported');
    mockConstants.executionEnvironment = 'bare'; // development build بلا projectId
    expect(await registerPushToken(mockClient as never, { ask: true })).toBe('unsupported');
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(env.rpcCalls).toHaveLength(0);
  });

  it('development build with projectId: asks, then register_push_token (provider expo)', async () => {
    Device.isDevice = true;
    mockConstants.executionEnvironment = 'bare';
    mockConstants.expoConfig.extra = { eas: { projectId: 'proj-1' } };
    const env = setup();
    expect(await registerPushToken(mockClient as never, { ask: true })).toBe('registered');
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(env.rpcCalls).toEqual([
      {
        fn: 'register_push_token',
        args: { p_token: 'ExponentPushToken[test]', p_platform: 'ios', p_provider: 'expo' },
      },
    ]);
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBe('ExponentPushToken[test]');
  });

  it('without asking, an undetermined permission registers nothing', async () => {
    Device.isDevice = true;
    mockConstants.executionEnvironment = 'bare';
    mockConstants.expoConfig.extra = { eas: { projectId: 'proj-1' } };
    const env = setup();
    expect(await registerPushToken(mockClient as never, { ask: false })).toBe('denied');
    expect(env.rpcCalls).toHaveLength(0);
  });

  it('sign-out removes this device token row', async () => {
    const env = setup();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[abc]');
    await unregisterPushToken(mockClient as never);
    const call = env.calls.find((c) => c.table === 'push_tokens') as Call;
    expect(call.ops.map(([n]) => n)).toEqual(['delete', 'eq']);
    expect(opArgs(call, 'eq')).toEqual(['token', 'ExponentPushToken[abc]']);
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });

  it('sign-out without a stored token does nothing', async () => {
    const env = setup();
    await unregisterPushToken(mockClient as never);
    expect(env.calls).toHaveLength(0);
  });
});
