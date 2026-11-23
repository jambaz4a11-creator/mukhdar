// T43: رسالة حد الكمية تعتمد على وحدة بنود السلة: الكيلو يُذكر فقط حين كلها "نص كيلو".
import { ERROR_MESSAGES } from '@mukhdar/shared';
import { placeOrderMessage } from '../features/checkout/usePlaceOrder';

const base = ERROR_MESSAGES.QTY_LIMIT;

describe('placeOrderMessage QTY_LIMIT', () => {
  it('half-kilo only: mentions kilos', () => {
    expect(placeOrderMessage('QTY_LIMIT', '20', ['نص كيلو', 'نص كيلو'])).toBe(
      `${base} (الحد 20 لكل منتج، يعني 10 كيلو)`,
    );
  });

  it.each([[['كيس']], [['عبوة', 'باقة']], [['نص كيلو', 'كيس']], [[null]], [[]]])(
    'other, mixed or unknown units (%j): count only',
    (units) => {
      expect(placeOrderMessage('QTY_LIMIT', '20', units)).toBe(`${base} (الحد 20 لكل منتج)`);
    },
  );

  it('without units given: count only', () => {
    expect(placeOrderMessage('QTY_LIMIT', '20')).toBe(`${base} (الحد 20 لكل منتج)`);
  });
});
