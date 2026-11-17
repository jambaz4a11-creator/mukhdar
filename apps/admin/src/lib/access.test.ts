import { describe, expect, it } from 'vitest';
import {
  PAGE_ACCESS,
  canAccess,
  isNavActive,
  isPanelRole,
  isPublicPath,
  navItems,
  safeNext,
  type PanelRole,
} from './access';

// جدول SPEC-admin §1 كاملاً: الصفحة ← (admin, staff)
const TABLE: [string, string, boolean, boolean][] = [
  ['الرئيسية', '/', true, true],
  ['الطلبات', '/orders', true, true],
  ['المخزون (الأرصدة)', '/stock', true, true],
  ['هدر اليوم', '/waste', true, false],
  ['التقييمات', '/ratings', true, true],
  ['المنتجات والأقسام', '/products', true, false],
  ['العناوين', '/addresses', true, false],
  ['التقارير والأرباح', '/reports', true, false],
  ['الموظفون والسائقون', '/staff', true, false],
  ['الإعدادات', '/settings', true, false],
  // ليست صفحة بجدول §1: إيصال طباعة الطلب (T17) لمن يرى الطلبات
  ['طباعة الطلب', '/print', true, true],
  ['تغيير الرمز', '/change-pin', true, true],
  ['المصادقة الثنائية (T23)', '/mfa', true, true],
];

describe('canAccess (SPEC-admin §1)', () => {
  it.each(TABLE)('%s %s: admin=%s staff=%s', (_label, path, admin, staff) => {
    expect(canAccess('admin', path)).toBe(admin);
    expect(canAccess('staff', path)).toBe(staff);
  });

  it('covers every page in PAGE_ACCESS (no page without a row in the table)', () => {
    expect(Object.keys(PAGE_ACCESS).sort()).toEqual(TABLE.map((r) => r[1]).sort());
  });

  it('applies to nested paths and query-less sub-routes', () => {
    expect(canAccess('staff', '/orders/123')).toBe(true);
    expect(canAccess('staff', '/products/new')).toBe(false);
    expect(canAccess('staff', '/settings/')).toBe(false);
  });

  it('denies unknown paths', () => {
    expect(canAccess('admin', '/unknown')).toBe(false);
    expect(canAccess('staff', '/unknown')).toBe(false);
  });
});

describe('roles', () => {
  it('only admin and staff are panel roles', () => {
    expect(isPanelRole('admin')).toBe(true);
    expect(isPanelRole('staff')).toBe(true);
    for (const r of ['customer', 'driver', '', null, undefined, 'Admin'])
      expect(isPanelRole(r)).toBe(false);
  });
});

describe('public pages', () => {
  it.each(['/privacy', '/terms', '/delete-account', '/delete-account/'])('%s is public', (p) => {
    expect(isPublicPath(p)).toBe(true);
  });
  it.each(['/', '/login', '/orders', '/privacy-x', '/settings'])('%s is not public', (p) => {
    expect(isPublicPath(p)).toBe(false);
  });
});

describe('navItems (sidebar per role, design order)', () => {
  it('admin sees the 7 design items in order', () => {
    expect(navItems('admin').map((i) => i.label)).toEqual([
      'الرئيسية',
      'الطلبات',
      'المنتجات والمخزون',
      'هدر اليوم',
      'التقييمات',
      'التقارير والأرباح',
      'الإعدادات والموظفون',
    ]);
  });

  it('staff sees home, orders, stock and ratings only', () => {
    expect(navItems('staff').map((i) => i.href)).toEqual(['/', '/orders', '/stock', '/ratings']);
  });

  it.each<PanelRole>(['admin', 'staff'])(
    'every %s item links to a page the role can open',
    (role) => {
      for (const item of navItems(role)) {
        expect(canAccess(role, item.href)).toBe(true);
        for (const m of item.match) expect(canAccess(role, m)).toBe(true);
      }
    },
  );

  it('orders carries the pending badge', () => {
    expect(navItems('staff').find((i) => i.href === '/orders')?.badge).toBe('pendingOrders');
  });

  it('marks the right item active', () => {
    const admin = navItems('admin');
    const active = (p: string) => admin.filter((i) => isNavActive(i, p)).map((i) => i.href);
    expect(active('/')).toEqual(['/']);
    expect(active('/stock')).toEqual(['/products']);
    expect(active('/staff')).toEqual(['/settings']);
    expect(active('/orders/5')).toEqual(['/orders']);
  });
});

describe('safeNext', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/orders?tab=ready', '/orders?tab=ready'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/login?next=/x', '/'],
  ])('%s -> %s', (input, out) => {
    expect(safeNext(input)).toBe(out);
  });
});
