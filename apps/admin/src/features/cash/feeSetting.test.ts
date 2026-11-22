import { describe, expect, it } from 'vitest';
import {
  FEE_OPTIONS,
  FEE_SECTION_TITLE,
  FEE_WARNING,
  feeChangeWarning,
  feePayload,
} from './feeSetting';

describe('delivery-fee handover setting (SPEC-cash K19, §4)', () => {
  it('has exactly the two options, the shop-keeps-the-fee one first (the default)', () => {
    expect(FEE_OPTIONS.map((o) => o.value)).toEqual([true, false]);
    expect(FEE_OPTIONS[0]?.label).toBe('أجرة التوصيل للمحل');
    expect(FEE_OPTIONS[1]?.label).toBe('أجرة التوصيل تبقى عند السائق');
  });

  it('explains each option in Arabic', () => {
    expect(FEE_OPTIONS[0]?.description).toBe(
      'السائق يسلّم المجموع كاملاً (البضاعة + أجرة التوصيل)، والمحل يدفع للسائق أجوره بطريقته.',
    );
    expect(FEE_OPTIONS[1]?.description).toBe(
      'السائق يسلّم مبلغ البضاعة فقط ويحتفظ بأجرة كل توصيل.',
    );
  });

  it('carries the "applies only going forward" warning', () => {
    expect(FEE_WARNING).toBe(
      'التغيير يسري على الكاش اللي بيد السواق الآن والتسليمات الجاية فقط. التسليمات المسجّلة قبل التغيير ما تتغير.',
    );
  });

  it('has the section title', () => {
    expect(FEE_SECTION_TITLE).toBe('أجرة التوصيل وتسليم الكاش');
  });

  it('saves through update_app_settings with only the one key (booleans, never other settings)', () => {
    expect(feePayload(true)).toEqual({ cash_handover_includes_delivery_fee: true });
    expect(feePayload(false)).toEqual({ cash_handover_includes_delivery_fee: false });
  });

  it('R4 M1: no confirmation when no driver holds delivery fees', () => {
    expect(feeChangeWarning({ driver_count: 0, order_count: 0, fees_iqd: 0 }, false)).toBeNull();
  });

  it('R4 M1: switching to "fee stays with the driver" names the drivers, orders and total that stop being collected', () => {
    const w = feeChangeWarning({ driver_count: 2, order_count: 10, fees_iqd: 10_000 }, false);
    expect(w).toContain('2 سائق');
    expect(w).toContain('10,000 د.ع');
    expect(w).toContain('10 طلب');
    expect(w).toContain('ما تنطلب منهم');
  });

  it('R4 M1: switching back to the shop says the fees are added to what they owe', () => {
    const w = feeChangeWarning({ driver_count: 1, order_count: 3, fees_iqd: 3_000 }, true);
    expect(w).toContain('3,000 د.ع');
    expect(w).toContain('تنضاف');
  });
});
