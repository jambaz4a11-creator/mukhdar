// الرئيسية (T11): الأقسام والشبكة، شريط "المتجر مغلق"، البحث بعد debounce مع نتيجة فارغة، شريط السلة.
import { formatIQD } from '@mukhdar/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import HomeScreen from '../app/(tabs)/index';
import { useCart } from '../features/cart/store';
import { ar } from '../i18n/ar';
import { type Call, createFakeSupabase, makeProduct, opArgs } from '../test-utils/fakeSupabase';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: (...a: unknown[]) => mockNavigate(...a) },
}));

const PRODUCTS = [
  makeProduct({ id: 't', name: 'طماطة', category_id: 1, price_iqd: 750 }),
  makeProduct({ id: 'b', name: 'موز', category_id: 2, price_iqd: 1000 }),
  makeProduct({ id: 'r', name: 'رمان', category_id: 2, in_stock: false }),
];

function setup(settings: { store_open: boolean; closed_message: string | null }) {
  const fake = createFakeSupabase((call: Call) => {
    if (call.table === 'app_settings') {
      return { data: { ...settings, delivery_fee_iqd: 1000, min_order_iqd: 0 }, error: null };
    }
    if (call.table === 'categories') {
      return {
        data: [
          { id: 1, name: 'خضار', sort_order: 1 },
          { id: 2, name: 'فواكه', sort_order: 2 },
        ],
        error: null,
      };
    }
    if (opArgs(call, 'ilike')) return { data: [], error: null };
    const cat = call.ops.find(([n, a]) => n === 'eq' && a[0] === 'category_id')?.[1][1];
    return {
      data: PRODUCTS.filter((p) => cat === undefined || p.category_id === cat),
      error: null,
    };
  });
  mockClient = fake.client;
  return fake;
}

async function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useCart.setState({ items: {} });
  mockNavigate.mockReset();
});

describe('home catalog', () => {
  it('shows category chips and the product grid; a chip filters by category', async () => {
    const fake = setup({ store_open: true, closed_message: null });
    await renderHome();
    expect(await screen.findByText('طماطة')).toBeTruthy();
    expect(screen.getByText('موز')).toBeTruthy();
    expect(await screen.findByText('فواكه')).toBeTruthy();
    expect(screen.getByText(ar.catalog.all)).toBeTruthy();
    expect(screen.queryByTestId('store-closed-banner')).toBeNull();

    await fireEvent.press(screen.getByText('فواكه'));
    // قائمة القسم الجديد تُحمَّل بعد الضغط: ننتظر ظهورها (موز) لا اختفاء القديمة فقط
    expect(await screen.findByText('موز')).toBeTruthy();
    expect(screen.queryByText('طماطة')).toBeNull();
    const last = fake.calls.filter((c) => c.table === 'products').at(-1) as Call;
    expect(last.ops).toContainEqual(['eq', ['category_id', 2]]);
  });

  it('shows the store-closed banner with closed_message', async () => {
    setup({ store_open: false, closed_message: 'مغلق للجرد، نرجع الساعة 8' });
    await renderHome();
    expect(await screen.findByText('مغلق للجرد، نرجع الساعة 8')).toBeTruthy();
    expect(screen.getByTestId('store-closed-banner')).toBeTruthy();
    // التصفح مسموح
    expect(await screen.findByText('طماطة')).toBeTruthy();
  });

  it('store closed without a message: default text', async () => {
    setup({ store_open: false, closed_message: null });
    await renderHome();
    expect(await screen.findByText(ar.home.storeClosed)).toBeTruthy();
  });

  it('search: one debounced request, empty result message', async () => {
    const fake = setup({ store_open: true, closed_message: null });
    await renderHome();
    await screen.findByText('طماطة');

    const input = screen.getByLabelText(ar.catalog.searchLabel);
    await fireEvent.changeText(input, 'ب');
    await fireEvent.changeText(input, 'بط');
    await fireEvent.changeText(input, 'بطيخ');

    expect(await screen.findByText(ar.catalog.noResults('بطيخ'))).toBeTruthy();
    expect(screen.getByText(ar.catalog.noResultsHint)).toBeTruthy();
    const searches = fake.calls.filter((c) => opArgs(c, 'ilike'));
    expect(searches).toHaveLength(1);
    expect(opArgs(searches[0] as Call, 'ilike')).toEqual(['name', '%بطيخ%']);
  });

  it('floating cart bar: appears after adding, shows count and total, opens the cart', async () => {
    setup({ store_open: true, closed_message: null });
    await renderHome();
    await screen.findByText('طماطة');
    expect(screen.queryByTestId('cart-bar')).toBeNull();

    await fireEvent.press(screen.getByLabelText(ar.catalog.addA11y('طماطة')));
    await fireEvent.press(screen.getByLabelText(ar.catalog.increase));
    await fireEvent.press(screen.getByLabelText(ar.catalog.addA11y('موز')));

    expect(screen.getByTestId('cart-bar')).toBeTruthy();
    // طماطة 2 × 750 + موز 1 × 1000
    expect(screen.getByText(formatIQD(2500))).toBeTruthy();
    expect(screen.getByLabelText(ar.catalog.viewCartA11y(2, formatIQD(2500)))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('cart-bar'));
    expect(mockNavigate).toHaveBeenCalledWith('/cart');
  });

  it('shows an Arabic error with retry (never the raw error)', async () => {
    const fake = createFakeSupabase((call) =>
      call.table === 'products'
        ? { data: null, error: { message: 'permission denied', code: '42501' } }
        : { data: [], error: null },
    );
    mockClient = fake.client;
    await renderHome();
    expect(await screen.findByText(ar.home.retry)).toBeTruthy();
    expect(screen.queryByText('permission denied')).toBeNull();
  });
});
