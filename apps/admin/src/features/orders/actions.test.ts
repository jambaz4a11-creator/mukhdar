import { ORDER_STATUSES, STATUS_TRANSITIONS, type OrderStatus } from '@mukhdar/shared';
import { describe, expect, it } from 'vitest';
import type { PanelRole } from '@/lib/access';
import { ACTION_TARGET, orderActions, validateCancelReason, type OrderAction } from './actions';

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
    admin: ['assign_driver', 'cancel'],
    staff: ['assign_driver', 'cancel'],
  },
  out_for_delivery: {
    admin: ['cancel'], // الإلغاء من بالطريق للأدمن وحده
    staff: [],
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

  it('never offers delivering or dispatching from the panel (driver-only transitions)', () => {
    for (const status of ORDER_STATUSES) {
      for (const role of ['admin', 'staff'] as const) {
        const targets = orderActions(status, role).map((a) => ACTION_TARGET[a]);
        expect(targets).not.toContain('delivered');
        expect(targets).not.toContain('out_for_delivery');
      }
    }
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
