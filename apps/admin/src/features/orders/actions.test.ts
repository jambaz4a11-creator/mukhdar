import { ORDER_STATUSES, STATUS_TRANSITIONS, type OrderStatus } from '@mukhdar/shared';
import { describe, expect, it } from 'vitest';
import type { PanelRole } from '@/lib/access';
import {
  ACTION_TARGET,
  actionBlocked,
  orderActions,
  validateCancelReason,
  type OrderAction,
} from './actions';

// (الحالة × الدور) ← الأزرار المتوقعة، حسب set_order_status وassign_driver (SPEC-backend §5).
const EXPECTED: Record<OrderStatus, Record<PanelRole, OrderAction[]>> = {
  pending: {
    admin: ['start_preparing', 'cancel'],
    staff: ['start_preparing', 'cancel'],
  },
  preparing: {
    admin: ['mark_ready', 'assign_driver', 'cancel'],
    staff: ['mark_ready', 'assign_driver', 'cancel'],
  },
  ready: {
    admin: ['assign_driver', 'mark_out_for_delivery', 'cancel'],
    staff: ['assign_driver', 'mark_out_for_delivery', 'cancel'],
  },
  out_for_delivery: {
    admin: ['mark_delivered', 'cancel'], // الإلغاء من بالطريق للأدمن وحده
    staff: ['mark_delivered'],
  },
  delivered: { admin: [], staff: [] },
  cancelled: { admin: [], staff: [] },
};

describe('orderActions (status × role)', () => {
  for (const status of ORDER_STATUSES) {
    for (const role of ['admin', 'staff'] as const) {
      it(`${status} / ${role} → ${EXPECTED[status][role].join(', ') || 'none'}`, () => {
        expect(orderActions(status, role)).toEqual(EXPECTED[status][role]);
      });
    }
  }

  it('every status button targets a valid transition from that status', () => {
    for (const status of ORDER_STATUSES) {
      for (const role of ['admin', 'staff'] as const) {
        for (const a of orderActions(status, role)) {
          const target = ACTION_TARGET[a];
          if (target) expect(STATUS_TRANSITIONS[status]).toContain(target);
        }
      }
    }
  });

  it('fallback out-for-delivery needs an assigned driver; delivered does not block', () => {
    expect(actionBlocked('mark_out_for_delivery', { driver_id: null })).toBe('عيّن سائقاً أولاً');
    expect(actionBlocked('mark_out_for_delivery', { driver_id: 'd1' })).toBeNull();
    expect(actionBlocked('mark_delivered', { driver_id: null })).toBeNull();
    expect(actionBlocked('start_preparing', { driver_id: null })).toBeNull();
  });
});

describe('validateCancelReason', () => {
  it('requires a reason', () => {
    expect(validateCancelReason('')).toBe('اكتب سبب الإلغاء');
    expect(validateCancelReason('   ')).toBe('اكتب سبب الإلغاء');
  });
  it('accepts up to 300 characters', () => {
    expect(validateCancelReason('المنتج نفد')).toBeNull();
    expect(validateCancelReason('x'.repeat(300))).toBeNull();
    expect(validateCancelReason('x'.repeat(301))).toMatch(/300/);
  });
});
