import {
  SALE_UNITS,
  adminPriceStep,
  adminQtyStep,
  adminUnitLabel,
  formatAdminQuantity,
  fromAdminPrice,
  fromAdminQty,
  isKiloProduct,
  isValidAdminPrice,
  isValidAdminQty,
  isValidPerKgPrice,
  kgToUnits,
  perKgToUnitPrice,
  toAdminPrice,
  toAdminQty,
  unitPriceToPerKg,
  unitsToKg,
} from '../index';

const HALF = 'نص كيلو';

describe('kilo conversion (SPEC-admin §2.9)', () => {
  it('kgToUnits: half-kilo units, negatives for adjustments, rejects non-0.5 steps', () => {
    expect(kgToUnits(2.5)).toBe(5);
    expect(kgToUnits(-1)).toBe(-2);
    expect(kgToUnits(0)).toBe(0);
    expect(Object.is(kgToUnits(-0), 0)).toBe(true);
    expect(() => kgToUnits(2.3)).toThrow(RangeError);
    expect(() => kgToUnits(NaN)).toThrow(RangeError);
    expect(() => kgToUnits(Infinity)).toThrow(RangeError);
  });

  it('unitsToKg', () => {
    expect(unitsToKg(5)).toBe(2.5);
    expect(unitsToKg(0)).toBe(0);
    expect(() => unitsToKg(1.5)).toThrow(RangeError);
  });

  it('per-kilo prices are multiples of 500', () => {
    expect(perKgToUnitPrice(3000)).toBe(1500);
    expect(() => perKgToUnitPrice(1250)).toThrow(RangeError);
    expect(() => perKgToUnitPrice(0)).toThrow(RangeError);
    expect(unitPriceToPerKg(1500)).toBe(3000);
    expect(isValidPerKgPrice(500)).toBe(true);
    expect(isValidPerKgPrice(1250)).toBe(false);
    expect(isValidPerKgPrice(-500)).toBe(false);
  });

  it('bunch, piece and other units pass through unchanged', () => {
    for (const unit of SALE_UNITS.filter((u) => u !== HALF)) {
      expect(isKiloProduct(unit)).toBe(false);
      expect(toAdminQty(3, unit)).toBe(3);
      expect(fromAdminQty(3, unit)).toBe(3);
      expect(toAdminPrice(250, unit)).toBe(250);
      expect(fromAdminPrice(1250, unit)).toBe(1250);
      expect(adminUnitLabel(unit)).toBe(unit);
      expect(adminQtyStep(unit)).toBe(1);
      expect(adminPriceStep(unit)).toBe(250);
    }
    expect(() => fromAdminQty(1.5, 'باقة')).toThrow(RangeError);
    expect(() => fromAdminPrice(1100, 'باقة')).toThrow(RangeError);
  });

  it('half-kilo products convert through the generic helpers', () => {
    expect(isKiloProduct(HALF)).toBe(true);
    expect(toAdminQty(21, HALF)).toBe(10.5);
    expect(fromAdminQty(2.5, HALF)).toBe(5);
    expect(toAdminPrice(1500, HALF)).toBe(3000);
    expect(fromAdminPrice(3000, HALF)).toBe(1500);
    expect(adminUnitLabel(HALF)).toBe('كيلو');
    expect(adminQtyStep(HALF)).toBe(0.5);
    expect(adminPriceStep(HALF)).toBe(500);
  });

  it('form validation helpers', () => {
    expect(isValidAdminPrice(1100, 'باقة')).toBe(false);
    expect(isValidAdminPrice(1100, HALF)).toBe(false);
    expect(isValidAdminPrice(1250, HALF)).toBe(false);
    expect(isValidAdminPrice(3000, HALF)).toBe(true);
    expect(isValidAdminPrice(1250, 'باقة')).toBe(true);
    expect(isValidAdminQty(2.3, HALF)).toBe(false);
    expect(isValidAdminQty(2.5, HALF)).toBe(true);
    expect(isValidAdminQty(2.5, 'حبة')).toBe(false);
  });

  it('formatAdminQuantity accepts zero (unlike formatQuantity)', () => {
    expect(formatAdminQuantity(0, HALF)).toBe('0 كيلو');
    expect(formatAdminQuantity(21, HALF)).toBe('10.5 كيلو');
    expect(formatAdminQuantity(3, 'باقة')).toBe('3 باقة');
    expect(formatAdminQuantity(-4, HALF)).toBe('-2 كيلو');
  });

  it('round-trips every valid value', () => {
    for (let units = -200; units <= 200; units++) {
      expect(fromAdminQty(toAdminQty(units, HALF), HALF)).toBe(units);
      expect(fromAdminQty(toAdminQty(units, 'باقة'), 'باقة')).toBe(units);
    }
    for (let price = 250; price <= 50_000; price += 250) {
      expect(fromAdminPrice(toAdminPrice(price, HALF), HALF)).toBe(price);
      expect(fromAdminPrice(toAdminPrice(price, 'حبة'), 'حبة')).toBe(price);
    }
  });
});
