// طلباتي (SPEC-driver §2.7، التصميم MyOrders): الحالات، العنوان الكامل (G)، الاسم، الكاش، Realtime، إزالة المختفي.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import MyOrdersScreen from '../app/(tabs)/my-orders';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { createFakeSupabase, type Call, type Result } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
    useFocusEffect: (cb: () => (() => void) | undefined) => useEffect(cb, [cb]),
  };
});

const order = (id: string, n: number, status: string, extra: object = {}) => ({
  id,
  order_number: n,
  status,
  address_snapshot: {
    sector: 'قطاع A',
    subsection: 'A3',
    building: '12',
    floor: 0,
    apartment: '4',
  },
  customer_name: 'حيدر',
  customer_phone: '9647701234567',
  total_iqd: 8250,
  note: null,
  created_at: '2026-11-20T09:00:00Z',
  assigned_at: '2026-11-20T09:10:00Z',
  ...extra,
});

/** channel().on(...).subscribe() مزيف يحتفظ بدالة الاستدعاء ليُطلق منها التغيير */
function withRealtime(fake: { client: object }) {
  const handlers: { filter: object; cb: () => void }[] = [];
  const removed: unknown[] = [];
  Object.assign(fake.client, {
    channel: () => {
      const ch = {
        on: (_t: string, filter: object, cb: () => void) => {
          handlers.push({ filter, cb });
          return ch;
        },
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: (ch: unknown) => removed.push(ch),
  });
  return { handlers, removed };
}

function setup(resolve: (call: Call) => Result) {
  const fake = createFakeSupabase(resolve);
  const rt = withRealtime(fake);
  mockClient = fake.client;
  return { ...fake, rt };
}

beforeEach(() => {
  mockPush.mockClear();
  useAuth.setState({
    ready: true,
    session: { user: { id: 'me' } } as never,
    profile: {
      role: 'driver',
      is_active: true,
      must_change_pin: false,
      full_name: 'ع',
      phone: '9647801112222',
    },
    profileError: false,
    hasRegistration: false,
    sessionOffline: false,
  });
});

describe('MyOrdersScreen', () => {
  it('cards: number, status label, full address with the ground floor as G, name, cash', async () => {
    setup(() => ({
      data: [
        order('a', 1045, 'out_for_delivery'),
        order('b', 1044, 'ready'),
        order('c', 1043, 'preparing'),
      ],
      error: null,
    }));
    await renderScreen(<MyOrdersScreen />);
    await screen.findByTestId('mine-card-a');
    expect(screen.getByText('بالطريق')).toBeTruthy();
    expect(screen.getByText('مقبول، بعده بالمحل')).toBeTruthy();
    expect(screen.getByText('بانتظار التحضير')).toBeTruthy();
    expect(screen.getAllByText('بلوك A3 · بناية 12 · الطابق G · شقة 4')).toHaveLength(3);
    expect(screen.getAllByText('حيدر')).toHaveLength(3);
    expect(screen.getAllByText('8,250 د.ع')).toHaveLength(3);
  });

  it('pressing a card opens the detail', async () => {
    setup(() => ({ data: [order('a', 1045, 'ready')], error: null }));
    await renderScreen(<MyOrdersScreen />);
    await fireEvent.press(await screen.findByTestId('mine-card-a'));
    expect(mockPush).toHaveBeenCalledWith('/order/a');
  });

  it('deleted customer: "حساب محذوف" instead of a name', async () => {
    setup(() => ({
      data: [
        order('a', 1, 'ready', {
          customer_name: null,
          customer_phone: null,
          address_snapshot: { sector: 'قطاع A', subsection: 'A3' },
        }),
      ],
      error: null,
    }));
    await renderScreen(<MyOrdersScreen />);
    await screen.findByTestId('mine-card-a');
    expect(screen.getByText(ar.orders.deletedCustomer)).toBeTruthy();
    expect(screen.getByText('بلوك A3')).toBeTruthy();
  });

  it('empty state', async () => {
    setup(() => ({ data: [], error: null }));
    await renderScreen(<MyOrdersScreen />);
    expect(await screen.findByText(ar.orders.mineEmpty)).toBeTruthy();
  });

  it('subscribes to Realtime filtered on my driver_id and unsubscribes on unmount', async () => {
    const t = setup(() => ({ data: [order('a', 1, 'ready')], error: null }));
    const view = await renderScreen(<MyOrdersScreen />);
    await screen.findByTestId('mine-card-a');
    expect(t.rt.handlers[0]?.filter).toMatchObject({
      event: '*',
      table: 'orders',
      filter: 'driver_id=eq.me',
    });
    await view.unmount();
    expect(t.rt.removed.length).toBeGreaterThan(0);
  });

  it('a Realtime change refetches; a cancelled order is removed with a message', async () => {
    let list = [order('a', 1045, 'ready'), order('b', 1044, 'ready')];
    const t = setup(() => ({ data: list, error: null }));
    await renderScreen(<MyOrdersScreen />);
    await screen.findByTestId('mine-card-b');
    list = [order('a', 1045, 'ready'), order('b', 1044, 'cancelled')];
    await act(async () => t.rt.handlers[0]?.cb());
    await waitFor(() => expect(screen.queryByTestId('mine-card-b')).toBeNull());
    expect(screen.getByTestId('mine-notice')).toHaveTextContent(ar.orders.removedCancelled(1044));
  });

  it('an order that disappears (moved to another driver) is removed with a message', async () => {
    let list = [order('a', 1045, 'ready'), order('b', 1044, 'out_for_delivery')];
    const t = setup(() => ({ data: list, error: null }));
    await renderScreen(<MyOrdersScreen />);
    await screen.findByTestId('mine-card-b');
    list = [order('a', 1045, 'ready')];
    await act(async () => t.rt.handlers[0]?.cb());
    await waitFor(() => expect(screen.queryByTestId('mine-card-b')).toBeNull());
    expect(screen.getByTestId('mine-notice')).toHaveTextContent(ar.orders.removedGone(1044));
  });
});
