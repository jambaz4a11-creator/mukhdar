// R2 C1: طلباتي وتفاصيل الطلب يعملان معاً (التبويب يبقى محمّلاً بعد زيارته). كل منهما باشتراك Realtime باسم خاص:
// فتح الطلب لا يرمي ولا يُنهي اشتراك القائمة. الـ client المزيف يطابق realtime-js (نفس الاسم ← نفس القناة، و`.on()`
// بعد `subscribe()` يرمي).
import { act, screen } from '@testing-library/react-native';
import MyOrdersScreen from '../app/(tabs)/my-orders';
import OrderDetailScreen from '../app/order/[id]';
import { useAuth } from '../features/auth/store';
import { subscribeMyOrders } from '../features/orders/mine';
import {
  createFakeSupabase,
  withRealtime,
  type Call,
  type Result,
} from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('../config', () => ({
  config: {
    supabaseUrl: 'https://x.supabase.co',
    supabaseKey: 'k',
    shopPhone: '0780',
    shopWhatsapp: '',
  },
  isSupabaseConfigured: () => true,
}));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
    useFocusEffect: (cb: () => (() => void) | undefined) => useEffect(cb, [cb]),
    useLocalSearchParams: () => ({ id: 'o1' }),
  };
});

const row = {
  id: 'o1',
  order_number: 1045,
  status: 'out_for_delivery',
  address_snapshot: {
    sector: 'قطاع A',
    subsection: 'A3',
    building: '12',
    floor: 0,
    apartment: '10',
  },
  customer_name: 'حيدر',
  customer_phone: '9647701234567',
  total_iqd: 8250,
  note: null,
  created_at: '2026-11-20T09:00:00Z',
  assigned_at: '2026-11-20T07:48:00Z',
  order_items: [],
};
const resolve = (call: Call): Result =>
  call.table === 'orders'
    ? {
        data: call.ops.some(([n]) => n === 'maybeSingle' || n === 'single') ? row : [row],
        error: null,
      }
    : { data: null, error: null };

beforeEach(() => {
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

describe('R2 C1: my-orders and order screens subscribe side by side', () => {
  it("opening an order while My orders is mounted does not throw and keeps the list's channel", async () => {
    const fake = createFakeSupabase(resolve);
    const rt = withRealtime(fake);
    mockClient = fake.client;

    const list = await renderScreen(<MyOrdersScreen />);
    await screen.findByTestId('mine-card-o1');
    expect(rt.live()).toHaveLength(1);

    // الشاشة الثانية تُركَّب والأولى ما زالت محمّلة (تبويب باقٍ)
    const detail = await renderScreen(<OrderDetailScreen />);
    await screen.findByTestId('detail-action');
    expect(rt.live()).toHaveLength(2);
    expect(new Set(rt.channels.map((c) => c.topic)).size).toBe(2);

    await detail.unmount();
    // إغلاق الطلب لا يلغي اشتراك القائمة
    expect(rt.live()).toHaveLength(1);
    expect(rt.live()[0]?.handlers).toHaveLength(1);
    await act(async () => rt.fire());

    await list.unmount();
    expect(rt.live()).toHaveLength(0);
  });

  it('the fake itself reproduces the bug: a shared topic would throw on the second .on()', () => {
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    withRealtime(fake);
    const c = fake.client as unknown as {
      channel(n: string): {
        on(t: string, f: object, cb: () => void): unknown;
        subscribe(): unknown;
      };
    };
    const first = c.channel('same');
    first.on('postgres_changes', {}, () => undefined);
    first.subscribe();
    expect(() => c.channel('same').on('postgres_changes', {}, () => undefined)).toThrow(
      /after `subscribe\(\)`/,
    );
  });

  it('two subscribeMyOrders calls for the same user get different topics', () => {
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    const rt = withRealtime(fake);
    const a = subscribeMyOrders(fake.client as never, 'me', () => undefined);
    const b = subscribeMyOrders(fake.client as never, 'me', () => undefined);
    expect(rt.live()).toHaveLength(2);
    a();
    expect(rt.live()).toHaveLength(1);
    b();
    expect(rt.live()).toHaveLength(0);
  });
});
