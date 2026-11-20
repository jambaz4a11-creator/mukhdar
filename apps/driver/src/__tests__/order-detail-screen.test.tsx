// تفاصيل الطلب (SPEC-driver §2.8، التصميم OrderDetail): العنوان بمربعات (G)، الاتصال/واتساب، المنتجات، الملاحظة، الكاش،
// الزر الثابت حسب الحالة، التأكيد المزدوج للتسليم، وأخطاء set_order_status.
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';
import OrderDetailScreen from '../app/order/[id]';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { createFakeSupabase, opArgs, type Call, type Result } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('../config', () => ({
  config: {
    supabaseUrl: 'https://x.supabase.co',
    supabaseKey: 'k',
    shopPhone: '07801112222',
    shopWhatsapp: '',
  },
  isSupabaseConfigured: () => true,
}));
const mockReplace = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: {
      replace: (...a: unknown[]) => mockReplace(...a),
      back: jest.fn(),
      canGoBack: () => true,
    },
    useFocusEffect: (cb: () => (() => void) | undefined) => useEffect(cb, [cb]),
    useLocalSearchParams: () => ({ id: 'o1' }),
  };
});

const detail = (status: string, extra: object = {}) => ({
  id: 'o1',
  order_number: 1045,
  status,
  address_snapshot: {
    sector: 'قطاع A',
    subsection: 'A3',
    building: '12',
    floor: 0,
    apartment: '10',
    note: 'الباب الأخضر',
  },
  customer_name: 'حيدر',
  customer_phone: '9647701234567',
  total_iqd: 8250,
  note: 'دك الجرس مرتين',
  created_at: '2026-11-20T09:00:00Z',
  assigned_at: '2026-11-20T07:48:00Z',
  order_items: [
    {
      name_snapshot: 'طماطة',
      unit_snapshot: 'نص كيلو',
      qty: 2,
      price_snapshot_iqd: 1000,
      line_total_iqd: 2000,
    },
    {
      name_snapshot: 'خيار',
      unit_snapshot: 'نص كيلو',
      qty: 1,
      price_snapshot_iqd: 750,
      line_total_iqd: 750,
    },
    {
      name_snapshot: 'موز',
      unit_snapshot: 'نص كيلو',
      qty: 3,
      price_snapshot_iqd: 1500,
      line_total_iqd: 4500,
    },
    {
      name_snapshot: 'نعناع',
      unit_snapshot: 'باقة',
      qty: 2,
      price_snapshot_iqd: 250,
      line_total_iqd: 500,
    },
  ],
  ...extra,
});

const driver = {
  role: 'driver',
  is_active: true,
  must_change_pin: false,
  full_name: 'ع',
  phone: '9647801112222',
};

function setup(resolve: (call: Call) => Result) {
  const fake = createFakeSupabase(resolve);
  Object.assign(fake.client, {
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: jest.fn(),
  });
  mockClient = fake.client;
  return fake;
}
const orderResolver =
  (status: string, extra: object = {}) =>
  (call: Call): Result =>
    call.table === 'orders'
      ? { data: detail(status, extra), error: null }
      : { data: null, error: null };

beforeEach(() => {
  mockReplace.mockClear();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  useAuth.setState({
    ready: true,
    session: { user: { id: 'me' } } as never,
    profile: driver,
    profileError: false,
    hasRegistration: false,
    sessionOffline: false,
  });
});
afterEach(() => jest.restoreAllMocks());

describe('OrderDetailScreen content', () => {
  it('header, address boxes (floor 0 shown as G), note, customer, items, cash', async () => {
    setup(orderResolver('out_for_delivery'));
    await renderScreen(<OrderDetailScreen />);
    expect(await screen.findByText('الطلب #1045')).toBeTruthy();
    expect(screen.getByText('قبلته الساعة 10:48 ص')).toBeTruthy();
    expect(screen.getByTestId('address-box-block')).toHaveTextContent('A3', { exact: false });
    expect(screen.getByTestId('address-box-building')).toHaveTextContent('12', { exact: false });
    expect(screen.getByTestId('address-box-floor')).toHaveTextContent('G', { exact: false });
    expect(screen.getByTestId('address-box-apartment')).toHaveTextContent('10', { exact: false });
    expect(screen.getByText('الباب الأخضر')).toBeTruthy();
    expect(screen.getByText('حيدر')).toBeTruthy();
    expect(screen.getByText('07701234567')).toBeTruthy();
    expect(screen.getByText('1 كيلو')).toBeTruthy();
    expect(screen.getByText('نص كيلو')).toBeTruthy();
    expect(screen.getByText('1.5 كيلو')).toBeTruthy();
    expect(screen.getByText('2 باقة')).toBeTruthy();
    expect(screen.getByTestId('detail-note')).toHaveTextContent('دك الجرس مرتين', { exact: false });
    expect(screen.getByTestId('detail-cash')).toHaveTextContent('8,250 د.ع', { exact: false });
  });

  it('missing floor hides that box (old address)', async () => {
    setup(
      orderResolver('ready', {
        address_snapshot: { sector: 'قطاع A', subsection: 'A3', building: '12', apartment: '5' },
      }),
    );
    await renderScreen(<OrderDetailScreen />);
    await screen.findByTestId('address-box-block');
    expect(screen.queryByTestId('address-box-floor')).toBeNull();
  });

  it('call and WhatsApp open tel:07… and wa.me/9647…', async () => {
    setup(orderResolver('out_for_delivery'));
    await renderScreen(<OrderDetailScreen />);
    await fireEvent.press(await screen.findByTestId('call-customer'));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:07701234567');
    await fireEvent.press(screen.getByTestId('whatsapp-customer'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://wa.me/9647701234567');
  });

  it('deleted customer: "حساب محذوف", only the block, no call buttons', async () => {
    setup(
      orderResolver('ready', {
        customer_name: null,
        customer_phone: null,
        note: null,
        address_snapshot: { sector: 'قطاع A', subsection: 'A3' },
      }),
    );
    await renderScreen(<OrderDetailScreen />);
    await screen.findByTestId('address-box-block');
    expect(screen.getByText(ar.orders.deletedCustomer)).toBeTruthy();
    expect(screen.queryByTestId('address-box-building')).toBeNull();
    expect(screen.queryByTestId('call-customer')).toBeNull();
    expect(screen.queryByTestId('whatsapp-customer')).toBeNull();
    expect(screen.queryByTestId('detail-note')).toBeNull();
  });

  it('"problem with the order? call the shop" opens the shop number', async () => {
    setup(orderResolver('ready'));
    await renderScreen(<OrderDetailScreen />);
    await fireEvent.press(await screen.findByTestId('detail-problem'));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+9647801112222');
  });
});

describe('sticky action button per status', () => {
  it('preparing: disabled "waiting for preparation", no call to set_order_status', async () => {
    const fake = setup(orderResolver('preparing'));
    await renderScreen(<OrderDetailScreen />);
    const btn = await screen.findByTestId('detail-waiting');
    expect(btn).toBeDisabled();
    expect(within(btn).getByText(ar.orders.waitPreparing)).toBeTruthy();
    expect(fake.calls.some((c) => c.table === 'rpc:set_order_status')).toBe(false);
  });

  it('ready: "picked up" goes to out_for_delivery with no confirmation', async () => {
    const fake = setup((call) =>
      call.table === 'rpc:set_order_status'
        ? { data: { id: 'o1', status: 'out_for_delivery' }, error: null }
        : orderResolver('ready')(call),
    );
    await renderScreen(<OrderDetailScreen />);
    await fireEvent.press(await screen.findByText(ar.orders.pickedUp));
    await waitFor(() =>
      expect(fake.calls.find((c) => c.table === 'rpc:set_order_status')).toBeTruthy(),
    );
    expect(
      opArgs(fake.calls.find((c) => c.table === 'rpc:set_order_status') as Call, 'rpc'),
    ).toEqual([{ p_order_id: 'o1', p_status: 'out_for_delivery' }]);
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
  });

  it.each(['delivered', 'cancelled'])('%s: no buttons', async (status) => {
    setup(orderResolver(status));
    await renderScreen(<OrderDetailScreen />);
    await screen.findByTestId('detail-cash');
    expect(screen.queryByTestId('detail-action')).toBeNull();
    expect(screen.queryByTestId('detail-waiting')).toBeNull();
  });
});

describe('delivery needs a double confirmation showing the amount', () => {
  it('first press opens the sheet with the amount; no RPC until confirmed', async () => {
    const fake = setup(orderResolver('out_for_delivery'));
    await renderScreen(<OrderDetailScreen />);
    await fireEvent.press(await screen.findByText(ar.orders.delivered));
    expect(await screen.findByTestId('confirm-sheet')).toBeTruthy();
    expect(screen.getByTestId('confirm-body')).toHaveTextContent('8,250 د.ع', { exact: false });
    expect(fake.calls.some((c) => c.table === 'rpc:set_order_status')).toBe(false);
  });

  it('"back" closes the sheet without calling the server', async () => {
    const fake = setup(orderResolver('out_for_delivery'));
    await renderScreen(<OrderDetailScreen />);
    await fireEvent.press(await screen.findByText(ar.orders.delivered));
    await fireEvent.press(await screen.findByTestId('confirm-no'));
    await waitFor(() => expect(screen.queryByTestId('confirm-sheet')).toBeNull());
    expect(fake.calls.some((c) => c.table === 'rpc:set_order_status')).toBe(false);
  });

  it('confirming sends delivered', async () => {
    const fake = setup((call) =>
      call.table === 'rpc:set_order_status'
        ? { data: { id: 'o1', status: 'delivered' }, error: null }
        : orderResolver('out_for_delivery')(call),
    );
    await renderScreen(<OrderDetailScreen />);
    await fireEvent.press(await screen.findByText(ar.orders.delivered));
    await fireEvent.press(await screen.findByTestId('confirm-yes'));
    await waitFor(() =>
      expect(
        opArgs(fake.calls.find((c) => c.table === 'rpc:set_order_status') as Call, 'rpc'),
      ).toEqual([{ p_order_id: 'o1', p_status: 'delivered' }]),
    );
  });
});

describe('errors', () => {
  it('INVALID_TRANSITION (changed from the panel): refetches the order', async () => {
    let status = 'ready';
    const fake = setup((call) =>
      call.table === 'rpc:set_order_status'
        ? ((status = 'out_for_delivery'),
          { data: null, error: { message: 'INVALID_TRANSITION', code: 'P0001' } })
        : orderResolver(status)(call),
    );
    await renderScreen(<OrderDetailScreen />);
    await fireEvent.press(await screen.findByText(ar.orders.pickedUp));
    // بعد الجلب الجديد صارت الحالة out_for_delivery فيظهر زر التسليم
    expect(await screen.findByText(ar.orders.delivered)).toBeTruthy();
    expect(fake.calls.filter((c) => c.table === 'orders').length).toBeGreaterThanOrEqual(2);
  });

  it('NOT_ALLOWED: "الطلب ما بقى إلك", re-reads the profile (R1 L6) and returns to my orders', async () => {
    const fake = setup((call) => {
      if (call.table === 'rpc:set_order_status')
        return { data: null, error: { message: 'NOT_ALLOWED', code: '42501' } };
      if (call.table === 'profiles') return { data: driver, error: null };
      return orderResolver('ready')(call);
    });
    await renderScreen(<OrderDetailScreen />);
    await fireEvent.press(await screen.findByText(ar.orders.pickedUp));
    expect(await screen.findByText(ar.orders.notYours)).toBeTruthy();
    expect(fake.calls.some((c) => c.table === 'profiles')).toBe(true);
    await fireEvent.press(screen.getByTestId('not-yours-ok'));
    expect(mockReplace).toHaveBeenCalledWith('/my-orders');
  });

  it('order no longer visible (moved/cancelled): message and a way back', async () => {
    setup((call) =>
      call.table === 'orders' ? { data: null, error: null } : { data: null, error: null },
    );
    await renderScreen(<OrderDetailScreen />);
    expect(await screen.findByText(ar.orders.gone)).toBeTruthy();
  });
});
