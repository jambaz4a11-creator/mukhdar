'use client';
// مزوّدات اللوحة: TanStack Query + اشتراك Realtime واحد على orders لكل الصفحات (شارة القائمة، الطلبات،
// والرئيسية لاحقاً). INSERT ← صوت تنبيه وإبطال استعلامات الطلبات؛ UPDATE ← إبطالها (الصفوف المعروضة تتحدث).
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { IdleGuard } from '@/components/IdleGuard';
import { createClient } from '@/lib/supabase/browser';
import { ordersKeys } from '@/features/orders/api';
import { maxWaitDebounce } from '@/lib/maxWaitDebounce';
import { PanelSessionExpiredError, leaveExpiredSession } from '@/lib/panelSession';
import { playNewOrderSound, unlockAudio } from '@/lib/sound';
import { silentReregister } from '@/features/notifications/pushClient';
import type { MukhdarClient } from '@mukhdar/shared';
import type { PanelRole } from '@/lib/access';

interface PanelContextValue {
  supabase: MukhdarClient;
  role: PanelRole;
  /** معرّفات الطلبات التي وصلت بهذه الجلسة (للتمييز بالجدول). */
  newOrderIds: ReadonlySet<string>;
  realtimeStatus: 'connecting' | 'live' | 'offline';
  /** يزيد بعد كل تسجيل صامت لإشعارات الجهاز، فتعيد "تنبيهات هذا الجهاز" قراءة حالتها (T44). */
  pushVersion: number;
}

const REFRESH_WAIT_MS = 250;
const REFRESH_MAX_WAIT_MS = 2000;

const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanel(): PanelContextValue {
  const v = useContext(PanelContext);
  if (!v) throw new Error('usePanel outside PanelProviders');
  return v;
}

export function PanelProviders({ children, role }: { children: React.ReactNode; role: PanelRole }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // T23 F M4: جلسة انتهت بالخمول ← صفحة الدخول برسالة (لا قائمة فارغة ولا إعادة محاولة)
        queryCache: new QueryCache({
          onError: (error) => {
            if (error instanceof PanelSessionExpiredError) void leaveExpiredSession(createClient());
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, error) => !(error instanceof PanelSessionExpiredError) && count < 1,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeBridge role={role}>{children}</RealtimeBridge>
    </QueryClientProvider>
  );
}

function RealtimeBridge({ children, role }: { children: React.ReactNode; role: PanelRole }) {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const [newOrderIds, setNewOrderIds] = useState<ReadonlySet<string>>(() => new Set());
  const [realtimeStatus, setStatus] = useState<PanelContextValue['realtimeStatus']>('connecting');
  const [pushVersion, setPushVersion] = useState(0);

  useEffect(() => {
    const unlock = () => void unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // T44 (SPEC-admin-push §4): اشتراك إشعارات **موجود** بهذا الجهاز يُربط بالجلسة الحالية عند الفتح والرجوع (الإرسال
  // للأدمن/الموظف مربوط بجلسته). لا يشترك من جديد ولا يطلب إذناً؛ مرة بالساعة لنفس الجلسة على الأكثر.
  useEffect(() => {
    let alive = true;
    const run = () =>
      void silentReregister(supabase).then(() => {
        if (alive) setPushVersion((v) => v + 1);
      });
    run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [supabase]);

  useEffect(() => {
    // دفعة تحديثات ← إعادة جلب واحدة؛ لكن تحت سيل مستمر (ذروة) لا ننتظر الهدوء: سقف انتظار 2 ثانية (M4).
    // الإبطال يطال الاستعلامات النشطة فقط (refetchType الافتراضي 'active')، ومنها الرئيسية (تحت ordersKeys.all).
    const invalidate = maxWaitDebounce(
      () => void queryClient.invalidateQueries({ queryKey: ordersKeys.all }),
      REFRESH_WAIT_MS,
      REFRESH_MAX_WAIT_MS,
    );
    const channel = supabase
      .channel('panel-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        const id = (payload.new as { id?: string }).id;
        if (id) setNewOrderIds((prev) => new Set(prev).add(id));
        playNewOrderSound();
        invalidate();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, invalidate)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setStatus('live');
          // ما فات أثناء الانقطاع
          void queryClient.invalidateQueries({ queryKey: ordersKeys.all });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setStatus('offline');
        }
      });
    return () => {
      invalidate.cancel();
      void supabase.removeChannel(channel);
    };
  }, [supabase, queryClient]);

  const value = useMemo(
    () => ({ supabase, role, newOrderIds, realtimeStatus, pushVersion }),
    [supabase, role, newOrderIds, realtimeStatus, pushVersion],
  );
  return (
    <PanelContext.Provider value={value}>
      <IdleGuard supabase={supabase} />
      {children}
    </PanelContext.Provider>
  );
}
