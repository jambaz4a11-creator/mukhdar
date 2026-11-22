// الطلبات الجاهزة (SPEC-driver §2.6، التصميم Main): البطاقة بلا بيانات الزبون، "قبله سائق ثاني"، القبول، الفارغة.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import ReadyScreen from '../app/(tabs)/index';
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

const NOW = Date.parse('2026-11-20T10:00:00Z');
const row = (id: string, n: number, extra: object = {}) => ({
  id,
  order_number: n,
  status: 'ready',
  sector: 'قطاع A',
  subsection: 'A3',
  building: '12',
  item_count: 9,
  line_count: 6,
  total_iqd: 12500,
  created_at: '2026-11-20T09:56:00Z',
  ...extra,
});
const driverProfile = {
  role: 'driver',
  is_active: true,
  must_change_pin: false,
  full_name: 'أبو علي',
  phone: '9647801112222',
};

function setup(resolve: (call: Call) => Result) {
  const fake = createFakeSupabase(resolve);
  mockClient = fake.client;
  return fake;
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockPush.mockClear();
  useAuth.setState({
    ready: true,
    session: { user: { id: 'me' } } as never,
    profile: driverProfile,
    profileError: false,
    hasRegistration: false,
    sessionOffline: false,
  });
});
afterEach(() => jest.restoreAllMocks());

describe('ReadyScreen', () => {
  it('card: number, "جاهز من N دقائق", block + building chips, N products, cash; no customer data', async () => {
    setup(() => ({ data: [row('o1', 1048)], error: null }));
    await renderScreen(<ReadyScreen />);
    await screen.findByTestId('ready-card-o1');
    expect(screen.getByText('#1048')).toBeTruthy();
    expect(screen.getByText('جاهز من 4 دقائق')).toBeTruthy();
    expect(screen.getByText('بلوك A3')).toBeTruthy();
    expect(screen.getByText('بناية 12')).toBeTruthy();
    expect(screen.getByText('6 منتجات')).toBeTruthy();
    expect(screen.getByText('12,500 د.ع')).toBeTruthy();
    expect(screen.getByText(ar.orders.accept)).toBeTruthy();
    // لا طابق ولا شقة ولا اسم قبل القبول
    expect(screen.queryByText(/الطابق/)).toBeNull();
    expect(screen.queryByText(/شقة/)).toBeNull();
  });

  it('old orders read in hours/days, not thousands of minutes ("جاهز من 4 أيام")', async () => {
    setup(() => ({
      data: [
        row('o1', 1, { created_at: '2026-11-20T08:00:00Z' }), // 120 دقيقة
        row('o2', 2, { created_at: new Date(NOW - 6391 * 60_000).toISOString() }),
      ],
      error: null,
    }));
    await renderScreen(<ReadyScreen />);
    await screen.findByTestId('ready-card-o2');
    expect(screen.getByText('جاهز من ساعتين')).toBeTruthy();
    expect(screen.getByText('جاهز من 4 أيام')).toBeTruthy();
    expect(screen.queryByText(/6391/)).toBeNull();
  });

  it('header: greeting with the driver name and the count badge', async () => {
    setup(() => ({ data: [row('o1', 1), row('o2', 2), row('o3', 3)], error: null }));
    await renderScreen(<ReadyScreen />);
    await screen.findByTestId('ready-card-o3');
    expect(screen.getByText('هلا أبو علي')).toBeTruthy();
    expect(screen.getByTestId('ready-count')).toHaveTextContent('3 طلبات');
  });

  it('empty state', async () => {
    setup(() => ({ data: [], error: null }));
    await renderScreen(<ReadyScreen />);
    expect(await screen.findByText(ar.orders.readyEmpty)).toBeTruthy();
  });

  it('accept success opens the order detail', async () => {
    setup((call) =>
      call.table === 'rpc:accept_order'
        ? { data: { id: 'o1' }, error: null }
        : { data: [row('o1', 1048)], error: null },
    );
    await renderScreen(<ReadyScreen />);
    await fireEvent.press(await screen.findByTestId('accept-o1'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/order/o1'));
  });

  it('R2 L1: a fast double tap calls accept_order once (no false "taken" on my own accept)', async () => {
    const t = setup((call) =>
      call.table === 'rpc:accept_order'
        ? { data: { id: 'o1' }, error: null }
        : { data: [row('o1', 1048)], error: null },
    );
    await renderScreen(<ReadyScreen />);
    const btn = await screen.findByTestId('accept-o1');
    // نقرتان بنفس الـ tick قبل إعادة الرسم
    await act(async () => {
      void fireEvent.press(btn);
      void fireEvent.press(btn);
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/order/o1'));
    expect(t.calls.filter((c) => c.table === 'rpc:accept_order')).toHaveLength(1);
  });

  it('lost the race: card dims with "قبله سائق ثاني", no accept button; the next refresh removes it', async () => {
    let list = [row('o1', 1048), row('o2', 1047)];
    const fake = setup((call) =>
      call.table === 'rpc:accept_order'
        ? { data: null, error: { message: 'ORDER_NOT_AVAILABLE', code: 'P0001' } }
        : { data: list, error: null },
    );
    await renderScreen(<ReadyScreen />);
    await fireEvent.press(await screen.findByTestId('accept-o1'));
    expect(await screen.findByTestId('taken-o1')).toHaveTextContent(ar.orders.takenByOther);
    expect(screen.queryByTestId('accept-o1')).toBeNull();
    expect(screen.getByTestId('accept-o2')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();

    list = [row('o2', 1047)];
    const before = fake.calls.length;
    await fireEvent(screen.getByTestId('ready-list'), 'refresh');
    await waitFor(() => expect(screen.queryByTestId('ready-card-o1')).toBeNull());
    expect(fake.calls.length).toBeGreaterThan(before);
    expect(screen.getByTestId('ready-card-o2')).toBeTruthy();
  });

  it('R1 L6: NOT_ALLOWED on accept re-reads the profile (guard) and shows no raw error', async () => {
    const fake = setup((call) => {
      if (call.table === 'profiles')
        return { data: { ...driverProfile, role: 'customer' }, error: null };
      if (call.table === 'rpc:accept_order')
        return { data: null, error: { message: 'NOT_ALLOWED', code: '42501' } };
      return { data: [row('o1', 1048)], error: null };
    });
    await renderScreen(<ReadyScreen />);
    await fireEvent.press(await screen.findByTestId('accept-o1'));
    await waitFor(() => expect(useAuth.getState().profile?.role).toBe('customer'));
    expect(fake.calls.some((c) => c.table === 'profiles')).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('R1 L6: NOT_ALLOWED on the list fetch re-reads the profile too', async () => {
    const fake = setup((call) =>
      call.table === 'profiles'
        ? { data: { ...driverProfile, must_change_pin: true }, error: null }
        : { data: null, error: { message: 'NOT_ALLOWED', code: '42501' } },
    );
    await renderScreen(<ReadyScreen />);
    await waitFor(() => expect(useAuth.getState().profile?.must_change_pin).toBe(true));
    expect(fake.calls.some((c) => c.table === 'profiles')).toBe(true);
  });

  it('network failure shows a retry message, not a crash', async () => {
    setup(() => ({ data: null, error: { message: 'TypeError: Network request failed' } }));
    await renderScreen(<ReadyScreen />);
    expect(await screen.findByTestId('ready-error')).toBeTruthy();
  });
});
