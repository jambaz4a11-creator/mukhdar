'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isNavActive, type NavItem, type PanelRole } from '@/lib/access';
import { signOut } from '@/app/actions';
import { NavIconSvg } from './icons';

interface Props {
  items: NavItem[];
  role: PanelRole;
  name: string | null;
  pendingOrders: number;
}

// القائمة الجانبية يمين الشاشة (RTL) كالتصميم المعتمد. على الموبايل: شريط علوي وزر يفتح القائمة.
export function Sidebar({ items, role, name, pendingOrders }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <aside className="border-b border-border bg-surface md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-b-0 md:border-l">
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:pt-5 md:pb-4">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <span className="flex size-10 items-center justify-center rounded-control bg-primary text-white">
            <NavIconSvg icon="products" />
          </span>
          <span className="flex flex-col">
            <span className="text-lg font-bold text-primary">المخضر</span>
            <span className="text-xs text-text-muted">لوحة الإدارة</span>
          </span>
        </Link>
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-control border border-border md:hidden"
          aria-expanded={open}
          aria-controls="panel-nav"
          aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
          onClick={() => setOpen((v) => !v)}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      <nav
        id="panel-nav"
        aria-label="القائمة الرئيسية"
        className={`${open ? 'flex' : 'hidden'} flex-col gap-1 px-3 pb-3 md:flex md:flex-1`}
      >
        {items.map((item) => {
          const active = isNavActive(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-2.5 rounded-control px-3 text-[15px] no-underline ${
                active ? 'bg-primary-soft font-bold text-primary' : 'text-text hover:bg-background'
              }`}
            >
              <span className={active ? 'text-primary' : 'text-text-muted'}>
                <NavIconSvg icon={item.icon} />
              </span>
              <span className="flex-1">{item.label}</span>
              {item.badge === 'pendingOrders' && pendingOrders > 0 && (
                <span
                  className="num flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-white"
                  aria-label={`${pendingOrders} طلب جديد`}
                  data-testid="orders-badge"
                >
                  {pendingOrders}
                </span>
              )}
            </Link>
          );
        })}
        <div className="mt-auto flex flex-col gap-2 border-t border-divider px-2 pt-3">
          <span className="text-sm">
            <span className="font-semibold">{name ?? 'بدون اسم'}</span>
            <span className="text-text-muted"> · {role === 'admin' ? 'مدير' : 'موظف'}</span>
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="flex min-h-11 w-full items-center rounded-control px-3 text-[15px] text-danger hover:bg-danger-soft"
            >
              تسجيل الخروج
            </button>
          </form>
        </div>
      </nav>
    </aside>
  );
}
