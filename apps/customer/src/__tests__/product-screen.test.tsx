// شاشة المنتج: التفاصيل، العداد (نص كيلو بكل ضغطة) والمجموع، وزر "أضف للسلة".
import { formatIQD } from '@mukhdar/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../test-utils/queryClient';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ProductScreen from '../app/product/[id]';
import { useCart } from '../features/cart/store';
import { ar } from '../i18n/ar';
import { createFakeSupabase, makeProduct, type Result } from '../test-utils/fakeSupabase';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 't' }),
}));

const TOMATO = makeProduct({
  id: 't',
  name: 'طماطة',
  description: 'طماطة محلية طازجة',
  price_iqd: 750,
});

function setup(product: unknown) {
  mockClient = createFakeSupabase((call): Result => {
    if (call.table === 'categories') {
      return { data: [{ id: 1, name: 'خضار', sort_order: 1 }], error: null };
    }
    return { data: product, error: null };
  }).client;
}

async function renderScreen() {
  const client = createTestQueryClient();
  return await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>
        <ProductScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  useCart.setState({ items: {} });
  mockBack.mockReset();
});

describe('product screen', () => {
  it('shows details; the stepper adds half a kilo per tap; add puts the quantity in the cart', async () => {
    setup(TOMATO);
    await renderScreen();
    expect(await screen.findByText('طماطة')).toBeTruthy();
    expect(screen.getByText('طماطة محلية طازجة')).toBeTruthy();
    expect(await screen.findByText('خضار · السعر لكل نص كيلو')).toBeTruthy();
    expect(screen.getByText(ar.catalog.inStock)).toBeTruthy();
    expect(screen.getByText('نص كيلو')).toBeTruthy();
    expect(screen.getByText(ar.product.addToCart)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(ar.catalog.increase));
    await fireEvent.press(screen.getByLabelText(ar.catalog.increase));
    expect(screen.getByText('1.5 كيلو')).toBeTruthy();
    expect(screen.getByText(formatIQD(3 * 750))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('product-add'));
    expect(useCart.getState().items).toEqual({ t: 3 });
    expect(mockBack).toHaveBeenCalled();
  });

  it('starts from the cart quantity and offers "update cart"', async () => {
    useCart.setState({ items: { t: 4 } });
    setup(TOMATO);
    await renderScreen();
    expect(await screen.findByText('2 كيلو')).toBeTruthy();
    expect(screen.getByText(ar.product.updateCart)).toBeTruthy();
  });

  it('out of stock: no stepper, disabled button', async () => {
    setup({ ...TOMATO, in_stock: false });
    await renderScreen();
    expect(await screen.findByText('طماطة')).toBeTruthy();
    expect(screen.queryByLabelText(ar.catalog.increase)).toBeNull();
    await fireEvent.press(screen.getByTestId('product-add'));
    expect(useCart.getState().items).toEqual({});
  });

  it('not found (inactive or deleted)', async () => {
    setup(null);
    await renderScreen();
    expect(await screen.findByText(ar.product.notFound)).toBeTruthy();
  });
});
