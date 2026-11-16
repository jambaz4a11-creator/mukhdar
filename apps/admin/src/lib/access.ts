// من يرى ماذا باللوحة (SPEC-admin §1). مصدر واحد للـ proxy والقائمة الجانبية وحماية الصفحات.
// الحماية الحقيقية بـ RLS والدوال؛ هذا للتوجيه والراحة (وحتى لا يفتح الموظف صفحة أدمن بالرابط).

export type PanelRole = 'admin' | 'staff';

/** الصفحات العامة: بلا دخول (Google Play وApp Store يطلبان روابطها). */
export const PUBLIC_PATHS = ['/privacy', '/terms', '/delete-account'] as const;
export const LOGIN_PATH = '/login';
export const NOT_AUTHORIZED_PATH = '/not-authorized';
/** تغيير رمز الدخول (SPEC-admin §2.6): إجباري برمز مؤقت، ومتاح دائماً من القائمة. */
export const CHANGE_PIN_PATH = '/change-pin';

/** كل صفحات اللوحة ومن يدخلها. أول جزء من المسار يحدد الصفحة. */
export const PAGE_ACCESS: Record<string, readonly PanelRole[]> = {
  '/': ['admin', 'staff'], // الرئيسية (الموظف بلا مبالغ، T25)
  '/orders': ['admin', 'staff'],
  '/stock': ['admin', 'staff'], // الأرصدة وتنبيه النقص (الحركات للأدمن داخل الصفحة)
  '/ratings': ['admin', 'staff'],
  '/products': ['admin'], // المنتجات والأقسام
  '/waste': ['admin'], // هدر اليوم
  '/addresses': ['admin'],
  '/reports': ['admin'],
  '/staff': ['admin'], // الموظفون والسائقون
  '/settings': ['admin'],
  '/print': ['admin', 'staff'], // إيصال 80mm للطلب (T17)، بلا قائمة
  '/change-pin': ['admin', 'staff'], // تغيير الرمز (مراجعة T16-T19)، بلا قائمة
};

export function isPanelRole(role: unknown): role is PanelRole {
  return role === 'admin' || role === 'staff';
}

function firstSegment(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)[0];
  return seg ? `/${seg}` : '/';
}

export function isPublicPath(pathname: string): boolean {
  const p = firstSegment(pathname);
  return (PUBLIC_PATHS as readonly string[]).includes(p);
}

/**
 * هل يدخل هذا الدور هذا المسار؟ مسار غير معروف ← false (يُترك لـ Next ليعرض 404 بعد الدخول،
 * لكن لا يُعطى صلاحية ضمنية).
 */
export function canAccess(role: PanelRole, pathname: string): boolean {
  const allowed = PAGE_ACCESS[firstSegment(pathname)];
  return allowed ? allowed.includes(role) : false;
}

export function isKnownPanelPath(pathname: string): boolean {
  return firstSegment(pathname) in PAGE_ACCESS;
}

export type NavIcon = 'home' | 'orders' | 'products' | 'waste' | 'ratings' | 'reports' | 'settings';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** مسارات أخرى تجعل العنصر نشطاً (مثلاً المخزون تحت "المنتجات والمخزون"). */
  match: readonly string[];
  /** شارة عدد الطلبات الجديدة */
  badge?: 'pendingOrders';
}

/** القائمة الجانبية حسب الدور، بترتيب التصميم المعتمد (يمين ← يسار = أعلى ← أسفل). */
export function navItems(role: PanelRole): NavItem[] {
  const home: NavItem = { href: '/', label: 'الرئيسية', icon: 'home', match: ['/'] };
  const orders: NavItem = {
    href: '/orders',
    label: 'الطلبات',
    icon: 'orders',
    match: ['/orders'],
    badge: 'pendingOrders',
  };
  const ratings: NavItem = {
    href: '/ratings',
    label: 'التقييمات',
    icon: 'ratings',
    match: ['/ratings'],
  };
  if (role === 'staff') {
    return [
      home,
      orders,
      { href: '/stock', label: 'المخزون', icon: 'products', match: ['/stock'] },
      ratings,
    ];
  }
  return [
    home,
    orders,
    {
      href: '/products',
      label: 'المنتجات والمخزون',
      icon: 'products',
      match: ['/products', '/stock'],
    },
    { href: '/waste', label: 'هدر اليوم', icon: 'waste', match: ['/waste'] },
    ratings,
    { href: '/reports', label: 'التقارير والأرباح', icon: 'reports', match: ['/reports'] },
    {
      href: '/settings',
      label: 'الإعدادات والموظفون',
      icon: 'settings',
      match: ['/settings', '/staff', '/addresses'],
    },
  ];
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  return item.match.includes(firstSegment(pathname));
}

/**
 * وجهة آمنة بعد الدخول: مسار داخلي فقط (لا "//host" ولا رابط خارجي)، وإلا الرئيسية.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.startsWith(LOGIN_PATH)) return '/';
  return next;
}
