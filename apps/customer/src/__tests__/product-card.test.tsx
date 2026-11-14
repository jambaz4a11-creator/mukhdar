// RNTL: بطاقة منتج متوفر/غير متوفر، وزر "أضف" الذي يتحول لعداد (كل ضغطة = وحدة بيع، العرض بـ formatQuantity).
import { formatIQD } from '@mukhdar/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProductCard } from '../components/ProductCard';
import { useCart } from '../features/cart/store';
import { ar } from '../i18n/ar';
import { makeProduct } from '../test-utils/fakeSupabase';

jest.mock('../lib/supabase', () => ({ getSupabase: () => null }));

beforeEach(() => {
  useCart.setState({ items: {} });
});

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
