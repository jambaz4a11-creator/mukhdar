// RNTL: بطاقة منتج متوفر/غير متوفر، وزر "أضف" الذي يتحول لعداد (كل ضغطة = وحدة بيع، العرض بـ formatQuantity)،
// وتصميم 2026-11-18: صورة مربعة بعرض البطاقة (contain على أبيض)، وبديل محايد بلا صورة، وارتفاع محسوب من العرض.
import { formatIQD } from '@mukhdar/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CARD_INFO_HEIGHT, cardHeight, ProductCard } from '../components/ProductCard';
import { useCart } from '../features/cart/store';
import { ar } from '../i18n/ar';
import { colors } from '../theme';
import { makeProduct } from '../test-utils/fakeSupabase';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));

const fakeStorageClient = {
  storage: {
    from: () => ({
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://img.test/${path}` } }),
    }),
  },
};

beforeEach(() => {
  mockClient = null;
  useCart.setState({ items: {} });
});

// الصورة مخفية عن قارئ الشاشة (الاسم بزر البطاقة)، فالاستعلام يشمل المخفي
const HIDDEN = { includeHiddenElements: true };
const flat = (testID: string) => {
  const style = screen.getByTestId(testID, HIDDEN).props.style as unknown;
  return Object.assign({}, ...([style].flat(Infinity) as object[]));
};

describe('ProductCard', () => {
  it('available: name, price per sale unit and an add button', async () => {
    const onOpen = jest.fn();
    const p = makeProduct({ id: 't', name: 'طماطة', price_iqd: 750 });
    await render(<ProductCard product={p} onOpen={onOpen} />);
    expect(screen.getByText('طماطة')).toBeTruthy();
    expect(screen.getByText(formatIQD(750))).toBeTruthy();
    expect(screen.getByText(' / نص كيلو')).toBeTruthy();
    expect(screen.getByLabelText(ar.catalog.addA11y('طماطة'))).toBeTruthy();
    expect(screen.queryByText(ar.catalog.outOfStock)).toBeNull();

    await fireEvent.press(screen.getByText('طماطة'));
    expect(onOpen).toHaveBeenCalledWith(p);
  });

  it('add turns into a stepper: half a kilo per tap, shown with formatQuantity', async () => {
    const p = makeProduct({ id: 't', name: 'طماطة' });
    await render(<ProductCard product={p} onOpen={jest.fn()} />);

    await fireEvent.press(screen.getByLabelText(ar.catalog.addA11y('طماطة')));
    expect(screen.getByText('نص كيلو')).toBeTruthy();
    expect(useCart.getState().items).toEqual({ t: 1 });

    await fireEvent.press(screen.getByLabelText(ar.catalog.increase));
    expect(screen.getByText('1 كيلو')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(ar.catalog.increase));
    expect(screen.getByText('1.5 كيلو')).toBeTruthy();
    expect(useCart.getState().items).toEqual({ t: 3 });

    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByLabelText(ar.catalog.decrease));
    expect(useCart.getState().items).toEqual({});
    expect(screen.getByLabelText(ar.catalog.addA11y('طماطة'))).toBeTruthy();
  });

  it('bunch unit: "3 باقة"', async () => {
    useCart.setState({ items: { k: 3 } });
    const p = makeProduct({ id: 'k', name: 'كرفس', unit: 'باقة', price_iqd: 250 });
    await render(<ProductCard product={p} onOpen={jest.fn()} />);
    expect(screen.getByText('3 باقة')).toBeTruthy();
    expect(screen.getByText(' / باقة')).toBeTruthy();
  });

  it('out of stock: dimmed with "غير متوفر" and no add button', async () => {
    const p = makeProduct({ id: 'r', name: 'رمان', in_stock: false });
    await render(<ProductCard product={p} onOpen={jest.fn()} />);
    expect(screen.getByText(ar.catalog.outOfStock)).toBeTruthy();
    expect(screen.getByText(ar.catalog.outOfStockLong)).toBeTruthy();
    expect(screen.queryByLabelText(ar.catalog.addA11y('رمان'))).toBeNull();
    expect(screen.queryByLabelText(ar.catalog.increase)).toBeNull();
  });

  it('out of stock but still in the cart: no stepper', async () => {
    useCart.setState({ items: { r: 2 } });
    const p = makeProduct({ id: 'r', name: 'رمان', in_stock: false });
    await render(<ProductCard product={p} onOpen={jest.fn()} />);
    expect(screen.queryByLabelText(ar.catalog.increase)).toBeNull();
    expect(screen.getByText(ar.catalog.outOfStock)).toBeTruthy();
  });
});

describe('ProductCard layout (2026-11-18)', () => {
  it('the image is a square as wide as the card, contain on white', async () => {
    mockClient = fakeStorageClient;
    const p = makeProduct({ id: 't', name: 'طماطة', image_path: 'p/t.webp' });
    await render(<ProductCard product={p} onOpen={jest.fn()} width={154} />);
    const card = flat('product-card-t');
    expect(card.width).toBe(154);
    expect(card.height).toBe(cardHeight(154));
    const img = flat('product-image-t');
    expect(img.width).toBe(152); // داخل حد 1px من الجهتين
    expect(img.height).toBe(152);
    expect(img.backgroundColor).toBe(colors.surface);
    const photo = screen.getByTestId('product-image-t-photo', HIDDEN);
    expect(photo.props.contentFit).toBe('contain');
    expect([photo.props.source].flat()[0]).toEqual({ uri: 'https://img.test/p/t.webp' });
    expect(screen.queryByTestId('product-image-t-placeholder', HIDDEN)).toBeNull();
  });

  it('missing image: neutral placeholder with the first letter', async () => {
    mockClient = fakeStorageClient;
    const p = makeProduct({ id: 'b', name: 'بصل', image_path: null });
    await render(<ProductCard product={p} onOpen={jest.fn()} width={180} />);
    expect(screen.getByTestId('product-image-b-placeholder', HIDDEN)).toHaveTextContent(/ب$/); // أيقونة ورقة + أول حرف
    expect(flat('product-image-b').backgroundColor).toBe(colors.divider);
    expect(screen.queryByTestId('product-image-b-photo', HIDDEN)).toBeNull();
  });

  it('height grows with the width; the part under the image is fixed', () => {
    expect(cardHeight(154) - 154).toBe(CARD_INFO_HEIGHT);
    expect(cardHeight(300)).toBe(300 + CARD_INFO_HEIGHT);
    // 360px: البطاقة (360 - 40 - 12) / 2 = 154، والصورة أكبر من الجزء السفلي
    expect(154 - 2).toBeGreaterThan(CARD_INFO_HEIGHT);
  });
});

describe('cart store', () => {
  it('caps at 99 and removes a line at 0', () => {
    const { setQty, increment, decrement } = useCart.getState();
    setQty('a', 150);
    expect(useCart.getState().items.a).toBe(99);
    increment('a');
    expect(useCart.getState().items.a).toBe(99);
    setQty('a', 1);
    decrement('a');
    expect(useCart.getState().items).toEqual({});
    decrement('a');
    expect(useCart.getState().items).toEqual({});
  });
});
