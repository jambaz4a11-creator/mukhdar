'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isNavActive, type NavItem, type PanelRole } from '@/lib/access';
import { signOut } from '@/app/actions';
import { NavIconSvg } from './icons';
import { usePendingCount } from './usePendingCount';
import { usePendingDriverRequests } from './usePendingDriverRequests';
import { usePanel } from './PanelProviders';
import { DeviceAlerts } from '@/features/notifications/DeviceAlerts';
import { disableDevicePush } from '@/features/notifications/pushClient';
import { useTitleCount } from '@/features/notifications/useTitleCount';

/** الخروج لا ينتظر حذف اشتراك الإشعارات أكثر من هذا (بلا شبكة: حذف مؤجَّل + إبطال محلي). */
const SIGN_OUT_PUSH_WAIT_MS = 3000;

interface Props {
  items: NavItem[];
  role: PanelRole;
  name: string | null;
  pendingOrders: number;
  /** طلبات السواق المعلّقة (أدمن فقط؛ 0 للموظف) */
  pendingDriverRequests: number;
}

// القائمة الجانبية يمين الشاشة (RTL) كالتصميم المعتمد. على الموبايل: شريط علوي وزر يفتح القائمة.
export function Sidebar({ items, role, name, pendingOrders, pendingDriverRequests }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const pending = usePendingCount(pendingOrders);
  const driverRequests = usePendingDriverRequests(pendingDriverRequests, role === 'admin');
  const { supabase } = usePanel();
  const leaving = useRef(false);
  useEffect(() => setOpen(false), [pathname]);
  // T44: "(N) …" بعنوان التبويب = الطلبات الجديدة (نفس رقم الشارة، حي بـ Realtime)
  useTitleCount(pending);

  // T44 (SPEC-admin-push §4): حذف اشتراك إشعارات هذا الجهاز ثم unsubscribe **قبل** خروج الخادم (الخادم يحذف أيضاً
  // اشتراكات الجلسة بـ forget_session_push؛ الإشعارات لا تتوقف إلا بالخروج الصريح لا بالخمول)
  function onSignOut(e: React.FormEvent<HTMLFormElement>) {
    if (leaving.current) return; // الإرسال الثاني (requestSubmit) يمر للـ Server Action
    e.preventDefault();
    leaving.current = true;
    const form = e.currentTarget;
    const wait = new Promise((resolve) => setTimeout(resolve, SIGN_OUT_PUSH_WAIT_MS));
    void Promise.race([disableDevicePush(supabase), wait]).finally(() => form.requestSubmit());
  }

  return (
    <aside className="border-b border-border bg-surface md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-b-0 md:border-l">
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:pt-5 md:pb-4">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <span className="flex size-10 items-center justify-center rounded-control bg-primary text-white">
            <NavIconSvg icon="products" />
          </span>
          <span className="flex flex-col">
            <span className="text-lg font-bold text-primary">سوق بسماوي</span>
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
              {item.badge === 'pendingOrders' && pending > 0 && (
                <span
                  className="num flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-white"
                  aria-label={`${pending} طلب جديد`}
                  data-testid="orders-badge"
                >
                  {pending}
                </span>
              )}
              {item.badge === 'driverRequests' && driverRequests > 0 && (
                <span
                  className="num flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-white"
                  aria-label={`${driverRequests} طلب سائق بانتظار الموافقة`}
                  data-testid="driver-requests-badge"
                >
                  {driverRequests}
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
          <DeviceAlerts />
          <Link
            href="/change-pin"
            className="flex min-h-11 items-center rounded-control px-3 text-[15px] text-text no-underline hover:bg-primary-soft"
          >
            تغيير الرمز
          </Link>
          <form action={signOut} onSubmit={onSignOut}>
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
