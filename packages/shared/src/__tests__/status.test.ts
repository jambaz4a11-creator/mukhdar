import { Constants } from '../database.types';
import {
  ORDER_FLOW,
  ORDER_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_TRANSITIONS,
  canCustomerCancel,
  isFinalStatus,
  statusStep,
} from '../status';

describe('order statuses', () => {
  it('cover exactly the database enum', () => {
    expect([...ORDER_STATUSES].sort()).toEqual([...Constants.public.Enums.order_status].sort());
  });

  it('have an Arabic label and colors', () => {
    for (const s of ORDER_STATUSES) {
      expect(STATUS_LABELS[s]).toMatch(/[؀-ۿ]/);
      expect(STATUS_COLORS[s].text).toMatch(/^#[0-9A-F]{6}$/i);
      expect(STATUS_COLORS[s].background).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('transitions mirror set_order_status', () => {
    expect(STATUS_TRANSITIONS).toEqual({
      pending: ['preparing', 'cancelled'],
      preparing: ['out_for_delivery', 'cancelled'],
      out_for_delivery: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
    });
  });

  it('final statuses are delivered and cancelled', () => {
    expect(ORDER_STATUSES.filter(isFinalStatus)).toEqual(['delivered', 'cancelled']);
  });

  it('customer can cancel only while pending', () => {
    expect(ORDER_STATUSES.filter(canCustomerCancel)).toEqual(['pending']);
  });

  it('timeline steps', () => {
    expect(ORDER_FLOW.map(statusStep)).toEqual([0, 1, 2, 3]);
    expect(statusStep('cancelled')).toBe(-1);
  });
});
